@AGENTS.md

# Sceneify — Project Memory

Premium e-commerce lifestyle image generator. Takes a flat product photo + an **image-based preset** (folder of reference photos that show the desired output style), uses a vision LLM to write a garment-specific prompt that captures both the product and the target visual register, then calls fal.ai to render a lifestyle image that preserves the exact garment.

## Core flow (do not change without discussion)

```
Source image  ─┐
Preset refs   ─┤
(N images,    ─┼─► Vision LLM (Claude Sonnet 4.6 via @ai-sdk/anthropic)
 sampled max  ─┤    ├─ system: SYSTEM_PROMPT in prompt-construction.ts
 8 per call)  ─┘    └─► constructedPrompt (single block of prose)

Source image  ─┐
               ├─► fal.ai (gpt-image-2/edit OR nano-banana/edit)
constructedPrompt ┘    ├─ image_urls: [source public Blob url]
                       └─► output image  →  saved to Vercel Blob  →  Generation row
```

Why image-based presets: a text template can't capture a brand register fully ("studio lifestyle" means very different things). A folder of exemplar images lets the vision LLM extract concrete attributes — backdrop, lighting direction, model demographic, framing, post — and weave them into a prompt that the edit endpoint can faithfully render.

Why the two-stage pipeline: image-to-image alone with a generic prompt drifts the garment. The vision pass nails the garment description (color, hardware, pocket count, stitching) AND extracts the scene from the references; the edit endpoint preserves the garment.

## Stack

- Next.js 16 App Router (Turbopack, src dir, `@/*` alias)
- React 19, TypeScript 5, Tailwind v4
- AI SDK 6 + `@ai-sdk/anthropic` for vision prompt construction
- `@fal-ai/client` for image generation
- `@vercel/blob` for source/generated image storage (auto-used when `BLOB_READ_WRITE_TOKEN` is set)
- `nanoid` for ids, `zod` for input validation
- Node runtime on all routes (`runtime = "nodejs"`, `maxDuration = 300`)

## Image models (fal.ai endpoints)

Mapped in [src/lib/image-gen.ts](src/lib/image-gen.ts):

- `gpt-image-2` → `fal-ai/openai/gpt-image-2/edit` — primary, high quality
- `nano-banana-2` → `fal-ai/nano-banana/edit` — alternative

Both are *edit* endpoints (image-to-image). The source image must be passed as a publicly fetchable URL (`image_urls`). When `BLOB_READ_WRITE_TOKEN` is set, sources are stored in Vercel Blob and their Blob URLs are passed directly to fal — no tunneling needed.

If you add a new model, update: `ImageModelId` in [src/lib/types.ts](src/lib/types.ts), the endpoint map in [src/lib/image-gen.ts](src/lib/image-gen.ts), the zod enum in [src/app/api/generations/route.ts](src/app/api/generations/route.ts), and the `MODELS` array in [src/components/dashboard.tsx](src/components/dashboard.tsx).

## Presets (image-based)

A preset is a folder of reference images under `public/presets/<preset-id>/`. The server auto-discovers images at request time. To add a new preset:

1. Add metadata (id, name, description) to `PRESET_META` in [src/lib/presets.ts](src/lib/presets.ts).
2. Drop reference images into `public/presets/<id>/`. Supported extensions: `.jpg`, `.jpeg`, `.png`, `.webp`. Hidden files ignored.

Reference images can be many (50+ is fine). The vision call **samples up to 8 random references per generation** — see `MAX_REFERENCES_PER_CALL` in [src/lib/prompt-construction.ts](src/lib/prompt-construction.ts). This bounds Claude latency/cost and keeps the prompt model focused. If you raise the cap, watch token usage on long sessions.

The vision system prompt that handles all presets is `SYSTEM_PROMPT` in [src/lib/prompt-construction.ts](src/lib/prompt-construction.ts). It is generic — it just instructs Claude to describe the source garment exactly and extract the scene/style from the references. **Do not move scene-specific text into the system prompt.** The whole point of image-based presets is that the visual register comes from the reference images, not from text.

The first image attached in the multimodal message is always the source garment; remaining images are the sampled references. The user-text prompt makes this ordering explicit so Claude doesn't confuse them.

Currently shipped presets: `studio-direct` (Champion / Carhartt WIP studio register).

## Storage / persistence

- **Images**: [src/lib/storage.ts](src/lib/storage.ts) writes to Vercel Blob when `BLOB_READ_WRITE_TOKEN` is set; otherwise local `./public/uploads/`. Both source uploads and fal outputs flow through `saveBufferAsImage`. Production should always use Blob.
- **Metadata** (sources, generations only — presets are NOT in the DB): JSON file at `./data/db.json`. See [src/lib/db.ts](src/lib/db.ts). Single-process cache + serialized write queue. **Will not work on Vercel serverless** — swap to Postgres before deploy.
- **Presets**: filesystem-backed, no DB rows. See [src/lib/presets.ts](src/lib/presets.ts).

`db.ts` re-exports `loadPreset as getPreset` and `loadPresets as listPresets` so route handlers can import preset accessors from the same module as source/generation accessors.

## Env vars

Required at runtime:

- `ANTHROPIC_API_KEY` — vision prompt construction (Claude Sonnet 4.6 via `@ai-sdk/anthropic`).
- `FAL_KEY` — fal.ai client credentials. Read in [src/lib/image-gen.ts](src/lib/image-gen.ts).
- `BLOB_READ_WRITE_TOKEN` — auto-set when the Vercel Blob store is linked to the project.

**Caveat 1**: `vercel blob` and `vercel env` commands trigger an env pull that overwrites `.env.local` with whatever is on Vercel. Any keys present only locally (e.g. `ANTHROPIC_API_KEY` typed straight into `.env.local`) **will be wiped** by these commands. To make them survive, add them to Vercel env via `vercel env add KEY` (interactive). Already happened once in dev — do not repeat.

**Caveat 2 (shell env shadowing)**: this user's shell (zsh / .zshrc) exports `ANTHROPIC_API_KEY=""` (empty) and `ANTHROPIC_BASE_URL=https://api.anthropic.com` (no `/v1`). Next.js does NOT override existing process env vars with `.env.local`, so the shell's empty key and broken base URL win, and the AI SDK fails with confusing errors ("Not Found", "x-api-key header is required"). Two defenses are in place:

1. The dev script in `package.json` is `unset ANTHROPIC_API_KEY ANTHROPIC_BASE_URL; next dev` — so `.env.local` wins on `pnpm dev`.
2. `prompt-construction.ts` and `describe-image.ts` use `createAnthropic({ baseURL: "https://api.anthropic.com/v1", apiKey: process.env.ANTHROPIC_API_KEY ?? "" })` instead of the default `anthropic` provider singleton, hardcoding the correct base URL regardless of env.

If you change runtimes (production, build, etc.), make sure these defenses survive — otherwise the same 404 will reappear.

## API surface

- `GET /api/sources` → `{ sources: Source[] }`
- `POST /api/sources` (multipart, field `file`) → `{ source }`. Writes to Blob if token present, else local fs.
- `GET /api/presets` → `{ presets: Preset[] }` (filesystem-backed via [src/lib/presets.ts](src/lib/presets.ts))
- `GET /api/generations?sourceId=…` → `{ generations: Generation[] }`
- `POST /api/generations` body `{ sourceId, presetId, model }` → `{ generation }`. Synchronous: prompt construction → fal call → save → respond. Long, hence `maxDuration = 300`. Status transitions: `pending → running → succeeded|failed`. The dashboard polls `/api/generations` every 2.5s while requests are in flight.
- `GET /api/generations/:id` → `{ generation }`

## Data model

In [src/lib/types.ts](src/lib/types.ts):

- `Source { id, url, filename, mimeType, createdAt }` — uploaded product photo.
- `Generation { id, sourceId, presetId, model, status, constructedPrompt?, outputUrl?, error?, createdAt, completedAt? }` — `constructedPrompt` is the actual prompt sent to fal, surfaced in the UI for inspection.
- `Preset { id, name, description, referenceImageUrls }` — `referenceImageUrls` is auto-discovered from the filesystem on each request, never persisted.
- `ImageModelId = "gpt-image-2" | "nano-banana-2"`.
- `GenerationStatus = "pending" | "running" | "succeeded" | "failed"`.

## Conventions in this repo

- Server-rendered home (`force-dynamic`) reads sources/generations/presets at request time, hydrates client component with initial data, then the client polls.
- All API routes pin Node runtime; do not switch to Edge — JSON file writes and Buffer/fs need Node, and gpt-image-2/edit can run >60s.
- User prefers no comments unless WHY is non-obvious. No trailing summaries. No emojis.
- Storage layer ([src/lib/storage.ts](src/lib/storage.ts)) is the only swap-point for image persistence; `db.ts` is the only swap-point for metadata persistence. Don't introduce new abstractions on top of them.
- Don't move preset scene-specific text into a system prompt or template. Reference images carry the scene; the system prompt stays generic.

## Known limits / TODO before prod

- JSON file db won't survive on Vercel serverless — swap to Postgres (Neon via Marketplace).
- No auth.
- No rate limiting on `/api/generations`. fal calls cost real money.
- Reference image sampling is uniform random. If we add demographic/style variation within a preset (e.g. "athletic-lit", "studio-direct-female"), consider stratified sampling or splitting into separate preset folders.
- Synchronous generation route relies on `maxDuration = 300`. If gpt-image-2 latencies grow, switch to async (Vercel Queues + polling).
