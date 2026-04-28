@AGENTS.md

# Sceneify — Project Memory

Premium e-commerce lifestyle image generator. Takes a flat product photo + an **image-based preset** (folder of reference photos that show the desired output style), uses a vision LLM to write a garment-specific prompt that captures both the product and the target visual register, then calls fal.ai to render a lifestyle image that preserves the exact garment.

Production: https://sceneify-wheat.vercel.app (gated to allowlisted Google sign-ins).

## Core flow (do not change without discussion)

```
Source image  ─┐
Preset refs   ─┤
(N images,    ─┼─► Vision LLM (gpt-4o via @ai-sdk/openai, generateObject)
 sampled max  ─┤    ├─ system: per-register catalog + structure spec
 4 per call)  ─┘    └─► { register: RegisterId, prompt: string }
                          ↑ LLM picks register from references; we don't ask the user.
Source colors ─┐
(extracted    ─┘   injected as REQUIRED COLOR ANCHORS in the user message
 via sharp)

Source image url + constructedPrompt ─► fal.ai (gpt-image-2 / nano-banana / flux-kontext / flux-2)
                                            ├─ image_urls: [source public Blob url]
                                            └─► output image
                                                  ├─► sharp resize to size profile target
                                                  ├─► save to Vercel Blob
                                                  ├─► extract output colors → ΔE vs source
                                                  └─► persist Generation row in Neon
```

Why image-based presets: a text template can't capture a brand register fully ("studio lifestyle" means very different things). A folder of exemplar images lets the vision LLM extract concrete attributes — backdrop, lighting direction, model demographic, framing, post — and weave them into a prompt that the edit endpoint can faithfully render.

Why the two-stage pipeline: image-to-image alone with a generic prompt drifts the garment. The vision pass nails the garment description (color, hardware, pocket count, stitching) AND extracts the scene from the references; the edit endpoint preserves the garment.

## Stack

- Next.js 16 App Router (Turbopack, src dir, `@/*` alias)
- React 19, TypeScript 5, Tailwind v4
- AI SDK 6 + `@ai-sdk/openai` for prompt construction (gpt-4o, `generateObject`). We moved off Anthropic because Claude refuses some intimate-apparel sources.
- `@fal-ai/client` for image generation
- Neon Postgres via `@neondatabase/serverless` + Drizzle ORM (`drizzle-orm/neon-http`)
- NextAuth.js v5 (`next-auth@beta`) — Google provider, JWT sessions, email allowlist
- `@vercel/blob` for source/generated image and preset reference storage (auto-used when `BLOB_READ_WRITE_TOKEN` is set)
- `sharp` for resize + dominant-color extraction
- `react-photo-album` (RowsPhotoAlbum) for justified-rows masonry
- `nanoid` for ids, `zod` for input validation
- Node runtime on all API routes (`runtime = "nodejs"`, `maxDuration = 300` on generations)

## Image models (fal.ai endpoints)

Mapped in [src/lib/image-gen.ts](src/lib/image-gen.ts):

- `gpt-image-2` → `fal-ai/openai/gpt-image-2/edit` — primary, high quality
- `nano-banana-2` → `fal-ai/nano-banana/edit` — fastest fallback, less strict content filter
- `flux-kontext` → `fal-ai/flux-pro/kontext` — strong identity preservation
- `flux-2` → `fal-ai/flux-2/edit` — newer FLUX, runs standalone (not in fallback chain)

All are *edit* endpoints (image-to-image). The source image must be passed as a publicly fetchable URL (`image_urls`). When `BLOB_READ_WRITE_TOKEN` is set, sources are stored in Vercel Blob and their Blob URLs are passed directly to fal — no tunneling needed.

**Fallback chain** (`FALLBACK_CHAIN` in image-gen.ts): on a 422 / content-policy error, gpt-image-2 → nano-banana-2 → flux-kontext. flux-2 stands alone (no fallback). The dashboard's `requestedModel` shows what the user picked; `model` reflects what actually rendered.

**gpt-image-2 size enum trap**: fal's gpt-image-2 endpoint expects `image_size: "square_hd" | "portrait_4_3" | "landscape_4_3"`, NOT raw dimensions. We map via `gptImage2SizeEnum()` in image-gen.ts. Passing `"1024x1024"` directly silently routes every request through the post-flight fallback chain to nano-banana — easy to miss because images still get generated.

If you add a new model, update: `ImageModelId` in [src/lib/types.ts](src/lib/types.ts), the endpoint map + fallback chain + `buildModelInput()` in [src/lib/image-gen.ts](src/lib/image-gen.ts), the zod enums in [src/app/api/generations/route.ts](src/app/api/generations/route.ts) and [src/app/api/listing-packs/route.ts](src/app/api/listing-packs/route.ts), and the `MODELS` array in [src/components/dashboard.tsx](src/components/dashboard.tsx).

## Visual register — auto-picked

Registers are defined in `REGISTERS` in [src/lib/types.ts](src/lib/types.ts):

- `catalog-dtc` — Aritzia, Skims, Reformation
- `editorial-fashion` — Frankies Bikinis, House of CB, Skims campaign
- `sun-drenched-lifestyle` — Free People, Reformation, Aerie
- `studio-glamour` — Tom Ford, Mugler, Margiela campaign

Each `RegisterConfig` carries `brandTriad`, `poseLanguage`, `lighting`, `skinTreatment`, `framing`, `closingLine`, `hint`.

**The user does NOT pick a register.** [src/lib/prompt-construction.ts](src/lib/prompt-construction.ts) sends the full register catalog to gpt-4o in the system prompt, plus the source image and 4 sampled reference scene-descriptions, and uses `generateObject` to return `{ register, prompt }` in one call. The LLM picks the register that best fits the references, then writes the prompt using that register's scaffolding (substituting `<register pose language>`, `<register lighting>`, etc. in the structure).

We persist the chosen register on the `Generation` row and surface it as a badge in the dashboard. **Do not re-introduce a Register dropdown** — that's exactly what the user asked us to remove.

## Prompt-construction system prompt — non-obvious bits

Lives in [src/lib/prompt-construction.ts](src/lib/prompt-construction.ts). The structure spec the LLM follows has six sections (OPENING / GARMENT PRESERVATION / SCENE / LIGHTING / QUALITY / CLOSING) and these directives that survive across registers:

- **GARMENT PRESERVATION** is forensic: button counts, pocket configuration, stitching color & density, yoke shape, branding text, condition cues. The hard preservation directive at the end is verbatim — do not paraphrase.
- **MODEL GENDER** must derive from the SOURCE garment's cut, NOT the references. Reference images that show a different-gender model define ONLY scene/lighting/pose register. Required because dark men's denim sources kept rendering female models when the references happened to be female-leaning.
- **REQUIRED COLOR ANCHORS** (Phase 1): we extract dominant colors from the source via sharp + 4-bit histogram and inject HEX values. The directive tells the LLM to disambiguate garment HEX from background/floor HEX, quote only garment HEX in the GARMENT PRESERVATION block, and restate the body color HEX twice. Saturated darks (indigo / charcoal / deep burgundy / forest green) drift hardest, so we explicitly call out a ~8 ΔE target on those.
- **HYPERREALISM / RAW SKIN** baseline is non-negotiable in section 5: pore texture, capillary redness, micro-creases, vellus hair, individual eyebrow hairs, a single natural mark, "looks like Wolfgang Tillmans / Juergen Teller / Tyrone Lebon". The per-register `skinTreatment` is layered on top, never replaces.
- **REQUIRED FRAMING** override is appended when listing-pack shots pass a `shotFraming` string (overrides the register's framing for that one shot — used to vary angle/crop while keeping everything else constant in the pack).

`MAX_REFERENCES_PER_CALL = 4` (down from 8). gpt-4o + 4 references + the register catalog + image input + structured output schema is the cost/quality sweet spot. If you raise the cap, watch token usage.

The first image attached in the multimodal message is always the source garment; references are passed as their pre-computed text descriptions (`describePresetImage()` runs once per ref, cached in DB), not as additional images. The user-text prompt makes this ordering explicit so the LLM doesn't confuse them.

**Do not move scene-specific text into a system prompt or template.** The whole point of image-based presets is that the visual register comes from the reference images, not from text.

## Listing packs

[src/lib/listing-packs.ts](src/lib/listing-packs.ts) — `LISTING_PACKS: Record<PackPlatform, PackSpec>` for amazon / shopify / instagram / tiktok. Each pack defines an array of shots; each shot has `role`, `label`, `framing` string, `sizeProfile`. Roles include `hero / three-quarter / profile / full-body / detail-hardware / detail-fabric`.

Flow:

1. `POST /api/listing-packs` plans the pack — returns a `packId`, a locked seed (so all shots share model identity on seed-honoring endpoints), and per-shot directives.
2. The dashboard fires N parallel `POST /api/generations` with the same `packId` + `seed`, each carrying its own `shotFraming` and `sizeProfile`.
3. Each shot independently runs `constructPrompt`, which **picks register based on the same references** — they almost always converge on the same register since they share a preset.

Seed is honored by nano-banana and flux-kontext; gpt-image-2 currently ignores it (identity drift between shots is the known limit).

## Color verification

[src/lib/color-extraction.ts](src/lib/color-extraction.ts):

- `extractDominantColors(buffer, n=4)` — sharp center-70%-crop → 64×64 → 4-bit-per-channel RGB histogram. Cheap, deterministic, no ML.
- `comparePalettes(source, output)` — greedy nearest-neighbor matching using CIE76 ΔE in CIE Lab space. Returns `{ maxDeltaE, avgDeltaE, matched }`.
- `classifyDelta`: <12 = ok, <25 = drift, ≥25 = severe.

Phase 1 (pre-flight): inject HEX into the prompt as anchors.
Phase 2 (post-flight): extract output colors after generation, compute ΔE vs source, persist `colorMaxDeltaE` / `colorAvgDeltaE` / source+output palettes on the Generation row. Dashboard renders a `ColorDriftBadge` showing the worst match.

If the user asks "what to do when ΔE is off": the next-level fix is **garment masking** before extraction (so background colors don't pollute the source palette). Not yet built. Current mitigation is the disambiguation directive in the prompt.

## Storage / persistence

- **Images** ([src/lib/storage.ts](src/lib/storage.ts)): writes to Vercel Blob when `BLOB_READ_WRITE_TOKEN` is set; falls back to local `./public/uploads/` only in dev. Sources, fal outputs, and preset references all flow through `saveBufferAsImage`. Production must use Blob.
- **Metadata** (Neon Postgres via Drizzle): preset, preset_image, source, generation, test_product. Schema in [src/lib/db/schema.ts](src/lib/db/schema.ts). `getDb()` returns a Drizzle handle from `@neondatabase/serverless`.
- The legacy JSON-file db is gone. Don't reintroduce it.

`src/lib/db.ts` is the canonical accessor module — `getPreset / listPresets / getSource / addGeneration / updateGeneration / getGeneration / listGenerations`. Routes import accessors from here only.

## Auth (NextAuth v5)

[src/lib/auth.ts](src/lib/auth.ts):

- Google OAuth provider, JWT sessions, `trustHost: true`.
- `signIn` callback rejects any email not in the allowlist (gblazer@gmail.com, info@slavablazer.com).
- `session` callback decorates the session with `isAdmin`.
- `isAdminEmail(email)` is the helper used by admin route handlers.

[src/middleware.ts](src/middleware.ts) gates the entire site:

- Allows `/api/auth/*` and `/admin/sign-in` always.
- Redirects unauthenticated page navigations to `/admin/sign-in`.
- Returns `401 JSON` for unauthenticated `/api/*` calls.

Admin routes (preset CRUD, image upload/move/delete/favorite) check `isAdminEmail` again at the handler level for defense-in-depth.

## Drag and drop (dashboard)

Two flows:

1. **Generated images → preset chip** = clone (Blob-clone via `POST /api/admin/presets/[id]/images` with `{sourceUrl}` JSON body).
2. **Multi-select reference images → different preset chip** = move (DB row reassign via `POST /api/admin/preset-images/move`).

Architecture quirks worth knowing:

- Custom MIME `application/x-sceneify-image-ids` carries the selected ids during a move. We dual-channel via `text/plain` with sentinel prefix `__sceneify-move__` because Safari strips custom MIMEs in some flows.
- `dataTransfer.types` is hidden during `dragover` for security in most browsers. The dashboard's `dragover` handlers always `preventDefault()` and only inspect types on `drop`.
- Source must set `effectAllowed = "copyMove"`. Setting just `"move"` while the target uses `dropEffect = "copy"` makes the browser silently refuse the drop.
- Multi-select drag uses a custom drag image (a stack of 3 thumbs + count badge) when ≥2 images are selected.
- `RowsPhotoAlbum.onClick` would wrap each photo in a `<button>`, which breaks our nested heart/inspect/delete buttons (HTML hydration error: button-in-button). We dropped `onClick` and use an absolute click overlay div.
- `RowsPhotoAlbum` with a single image renders full container width (giant). We cap via `rowConstraints={{ singleRowMaxHeight: targetRowHeight }}`.

## Env vars

Required at runtime:

- `OPENAI_API_KEY` — gpt-4o for prompt construction.
- `FAL_KEY` — fal.ai client credentials.
- `BLOB_READ_WRITE_TOKEN` — auto-injected by the Vercel Blob marketplace integration.
- `DATABASE_URL` — Neon Postgres connection string (auto-injected by the Neon marketplace integration).
- `AUTH_SECRET` — NextAuth JWT signing secret.
- `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` — Google OAuth client.

**Caveat 1**: `vercel blob` and `vercel env` commands trigger an env pull that overwrites `.env.local` with whatever is on Vercel. Any keys present only locally **will be wiped**. To make them survive, add them to Vercel env via `vercel env add KEY` first.

**Caveat 2 (shell env shadowing — recurring trap)**: this user's zsh exports `ANTHROPIC_API_KEY=""` (empty), `ANTHROPIC_BASE_URL=https://api.anthropic.com` (no `/v1`), and similar `OPENAI_API_KEY=""` / `OPENAI_BASE_URL` overrides. Next.js does NOT override existing process env vars with `.env.local`, so the shell's empty key wins and the AI SDK fails with cryptic 404s and `x-api-key required` errors. Two defenses are in place:

1. The dev script in `package.json` is `unset ANTHROPIC_API_KEY ANTHROPIC_BASE_URL OPENAI_API_KEY OPENAI_BASE_URL; next dev`.
2. [src/lib/prompt-construction.ts](src/lib/prompt-construction.ts) and [src/lib/describe-image.ts](src/lib/describe-image.ts) use `createOpenAI({ apiKey: process.env.OPENAI_API_KEY ?? "" })` instead of the default singleton.

If you change runtimes (production, build, etc.), make sure these defenses survive — otherwise the same 404 will reappear.

## API surface

Public:

- `GET /api/sources` → `{ sources: Source[] }`
- `POST /api/sources` (multipart, field `file`) → `{ source }`
- `GET /api/presets` → `{ presets: Preset[] }`
- `GET /api/generations?sourceId=…` → `{ generations: Generation[] }`
- `POST /api/generations` (NDJSON streaming) — body is `{ sourceId, presetId, model, referenceUrls?, sizeProfile?, quality?, seed?, reusePromptFromGenerationId?, packId?, packPlatform?, packRole?, packShotIndex?, shotFraming? }`. Response is a stream of `StreamEvent` lines (`started / phase / fal_queued / fal_log / fal_fallback / model_routed / prompt / done / error`). The dashboard consumes the stream incrementally to drive its progress UI.
- `GET /api/generations/:id` → `{ generation }`
- `POST /api/listing-packs` → returns `{ packId, platform, model, quality, seed, sourceId, presetId, shots: [...] }`. Plans the pack; the client fires the per-shot generations.

Admin (gated by `isAdminEmail` server-side):

- `POST /api/admin/presets` — create preset (auto-slug)
- `DELETE /api/admin/presets/[id]` — cascade delete preset + Blob cleanup
- `POST /api/admin/presets/[id]/images` — upload (multipart) OR clone-from-url (JSON `{sourceUrl}`)
- `POST /api/admin/preset-images/move` — bulk reassign preset_id (no Blob copy)
- `POST /api/admin/preset-images/delete-batch` — bulk delete with Blob cleanup
- `DELETE /api/admin/preset-images/[imageId]` — single delete
- `POST /api/admin/preset-images/[imageId]/favorite` — toggle favorited boolean

NextAuth:

- `/api/auth/*` — NextAuth handlers (sign-in, sign-out, callback, csrf, session).

## Data model (Drizzle / [src/lib/db/schema.ts](src/lib/db/schema.ts))

- `preset { id (nanoid), slug, name, description, createdAt }`
- `preset_image { id (nanoid), presetId (FK cascade), url, width, height, filename, favorited (bool), createdAt }` — also stores `descriptionPrompt` cache so we don't re-run `describePresetImage` on every generation.
- `source { id (nanoid), url, filename, mimeType, width?, height?, createdAt }`
- `generation { id, sourceId, presetId, model, requestedModel, size, quality, sizeProfile, seed, register, status, constructedPrompt, outputUrl, error, falEndpoint, falRequestId, falInput, falResponse, packId, packPlatform, packRole, packShotIndex, shotFraming, sourceColors, outputColors, colorMaxDeltaE, colorAvgDeltaE, createdAt, completedAt }`
- `test_product { id, url, filename, ... }` — curated source images for QA.

`Generation.register` is now LLM-decided, not user-decided. `requestedModel` differs from `model` only when the post-flight fallback chain kicked in.

## UI conventions

- Dashboard is the home page (`/`), `force-dynamic`. There's no separate "Presets" page anymore — preset management is a sticky 2-row chip strip at the top of the dashboard with a `+ New preset` inline tile.
- Action bar on the dashboard: Model / Quality / Size dropdowns + listing-pack platform selector + upload + bulk actions. **No register dropdown** (auto-picked).
- Reference panel splits into a favorites strip (fixed-height aspect-width tiles, smaller than main grid) and a main RowsPhotoAlbum masonry grid with pagination.
- Generation cards expose: model badge, requested-model "routed" badge, quality badge, size badge, register badge, color-drift badge, seed badge (with re-roll button), pack-role chip if part of a pack, regenerate button on failures, show-prompt and show-fal-request collapsibles. Click an image to open a lightbox.

## Conventions in this repo

- Server-rendered home (`force-dynamic`) reads sources/generations/presets at request time, hydrates the client component with initial data, then the client polls `/api/generations` every 2.5s while requests are in flight (in addition to the NDJSON stream from each in-flight call).
- All API routes pin Node runtime; do not switch to Edge — sharp, Buffer, fs, and gpt-image-2/edit can run >60s.
- User prefers no comments unless WHY is non-obvious. No trailing summaries. No emojis.
- Storage layer ([src/lib/storage.ts](src/lib/storage.ts)) is the only swap-point for image persistence; [src/lib/db.ts](src/lib/db.ts) is the only swap-point for metadata persistence. Don't introduce new abstractions on top of them.
- Don't move preset scene-specific text into a system prompt or template. References carry the scene; the system prompt stays generic.
- Don't reintroduce a user-selectable Register dropdown — it's auto-picked.

## Known limits / TODO before scaling

- No rate limiting on `/api/generations`. fal calls cost real money.
- Reference image sampling is uniform random. If we add demographic/style variation within a preset (e.g. "athletic-lit", "studio-direct-female"), consider stratified sampling or splitting into separate preset folders.
- Synchronous generation route relies on `maxDuration = 300`. If gpt-image-2 latencies grow, switch to async (Vercel Queues + polling).
- Color extraction does not mask the garment — background pollution still leaks into source palette. Garment masking via SAM or rembg is the next-level fix.
- gpt-image-2 ignores seed → identity drift across listing-pack shots. nano-banana and flux-kontext honor seed; consider defaulting packs to one of those.
- Tests are not yet wired up (vitest + Playwright planned).
