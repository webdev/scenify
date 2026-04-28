import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  addGeneration,
  getPreset,
  getSource,
  listGenerations,
  updateGeneration,
} from "@/lib/db";
import { constructPrompt } from "@/lib/prompt-construction";
import { generateImage } from "@/lib/image-gen";
import { publicUrl, fetchToBuffer, saveBufferAsImage } from "@/lib/storage";
import { resizeToTarget } from "@/lib/postprocess";
import {
  comparePalettes,
  extractDominantColors,
} from "@/lib/color-extraction";
import type {
  Generation,
  ImageModelId,
  ImageQuality,
  ImageSize,
  SizeProfileId,
} from "@/lib/types";
import { SIZE_PROFILES } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({
  sourceId: z.string().min(1),
  presetId: z.string().min(1),
  model: z.enum(["gpt-image-2", "nano-banana-2", "flux-kontext", "flux-2"]),
  referenceUrls: z.array(z.string()).optional(),
  sizeProfile: z.string().optional(),
  quality: z.enum(["low", "medium", "high", "auto"]).optional(),
  seed: z.number().int().nonnegative().optional(),
  register: z
    .enum([
      "catalog-dtc",
      "editorial-fashion",
      "sun-drenched-lifestyle",
      "studio-glamour",
    ])
    .optional(),
  reusePromptFromGenerationId: z.string().optional(),
  // Listing-pack fields. When packId is set, this generation is part of a
  // multi-shot pack. shotFraming overrides the framing language in the
  // constructed prompt for this specific shot.
  packId: z.string().optional(),
  packPlatform: z.string().optional(),
  packRole: z.string().optional(),
  packShotIndex: z.number().int().nonnegative().optional(),
  shotFraming: z.string().optional(),
});

function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

export type StreamEvent =
  | { type: "started"; generation: Generation }
  | { type: "phase"; phase: GenerationPhase; detail?: string }
  | { type: "fal_queued"; position?: number }
  | { type: "fal_log"; message: string }
  | {
      type: "fal_fallback";
      fromModel: ImageModelId;
      toModel: ImageModelId;
      reason: string;
    }
  | {
      type: "model_routed";
      fromModel: ImageModelId;
      toModel: ImageModelId;
      matched: string[];
    }
  | { type: "prompt"; constructedPrompt: string }
  | { type: "done"; generation: Generation }
  | { type: "error"; message: string; generation?: Generation };

export type GenerationPhase =
  | "fetching_source"
  | "constructing_prompt"
  | "calling_fal"
  | "saving_output";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sourceId = url.searchParams.get("sourceId") ?? undefined;
  const generations = await listGenerations(sourceId);
  return NextResponse.json({ generations });
}

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const {
    sourceId,
    presetId,
    model,
    referenceUrls,
    sizeProfile,
    quality,
    seed,
    register,
    reusePromptFromGenerationId,
    packId,
    packPlatform,
    packRole,
    packShotIndex,
    shotFraming,
  } = parsed.data;

  const [source, preset] = await Promise.all([
    getSource(sourceId),
    getPreset(presetId),
  ]);
  if (!source) return NextResponse.json({ error: "source not found" }, { status: 404 });
  if (!preset) return NextResponse.json({ error: "preset not found" }, { status: 404 });

  const profile = SIZE_PROFILES.find((p) => p.id === sizeProfile) ?? SIZE_PROFILES[0];
  const resolvedSize: ImageSize = profile.nativeSize;
  const resolvedQuality: ImageQuality = quality ?? "low";
  const resolvedSizeProfile: SizeProfileId = profile.id;

  let reusedConstructedPrompt: string | undefined;
  let reusedSeed: number | undefined;
  let reusedRegister: typeof register | undefined;
  if (reusePromptFromGenerationId) {
    const { getGeneration } = await import("@/lib/db");
    const prior = await getGeneration(reusePromptFromGenerationId);
    if (prior?.constructedPrompt) {
      reusedConstructedPrompt = prior.constructedPrompt;
      reusedSeed = prior.seed;
      reusedRegister = prior.register;
    }
  }

  const resolvedSeed: number = seed ?? reusedSeed ?? randomSeed();
  const resolvedRegister = register ?? reusedRegister ?? "catalog-dtc";

  const generation: Generation = {
    id: nanoid(12),
    sourceId,
    presetId,
    model: model as ImageModelId,
    requestedModel: model as ImageModelId,
    size: resolvedSize,
    quality: resolvedQuality,
    sizeProfile: resolvedSizeProfile,
    seed: resolvedSeed,
    register: resolvedRegister,
    status: "pending",
    constructedPrompt: reusedConstructedPrompt,
    packId,
    packPlatform,
    packRole,
    packShotIndex,
    shotFraming,
    createdAt: new Date().toISOString(),
  };
  await addGeneration(generation);

  const sourceAbsolute = publicUrl(req, source.url);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          // controller closed; ignore
        }
      };

      send({ type: "started", generation });

      try {
        await updateGeneration(generation.id, { status: "running" });

        // Always fetch the source buffer and extract dominant colors —
        // we use them in both the prompt (Phase 1: hex injection) and the
        // post-flight delta-E check (Phase 2: drift verification).
        send({ type: "phase", phase: "fetching_source" });
        const { buffer: sourceBuf, mimeType: sourceMime } =
          await fetchToBuffer(sourceAbsolute);
        const sourceColors = await extractDominantColors(sourceBuf, 4).catch(
          () => [],
        );

        let constructedPrompt: string;
        if (reusedConstructedPrompt) {
          constructedPrompt = reusedConstructedPrompt;
          send({ type: "prompt", constructedPrompt });
        } else {
          const imageBase64 = sourceBuf.toString("base64");

          send({ type: "phase", phase: "constructing_prompt" });
          constructedPrompt = await constructPrompt({
            preset,
            sourceImageBase64: imageBase64,
            sourceImageMimeType: sourceMime,
            referenceUrlsOverride: referenceUrls,
            register: resolvedRegister,
            shotFraming,
            sourceColors,
          });
          await updateGeneration(generation.id, { constructedPrompt });
          send({ type: "prompt", constructedPrompt });
        }

        // No pre-flight model routing. Default model (typically gpt-image-2)
        // is tried first; the post-flight fallback chain in image-gen.ts
        // catches 422 / content-policy responses and retries on the next
        // model in the chain. The card's `requestedModel` reflects the user's
        // pick; `model` reflects what actually rendered.
        send({ type: "phase", phase: "calling_fal" });
        const result = await generateImage({
          model: generation.model,
          prompt: constructedPrompt,
          referenceImageUrls: [sourceAbsolute],
          size: resolvedSize,
          quality: resolvedQuality,
          seed: resolvedSeed,
          onProgress: (e) => {
            if (e.type === "queued") {
              send({ type: "fal_queued", position: e.position });
            } else if (e.type === "in_progress") {
              for (const m of e.logs ?? []) {
                send({ type: "fal_log", message: m });
              }
            }
          },
          onFallback: (e) => {
            send({
              type: "fal_fallback",
              fromModel: e.fromModel,
              toModel: e.toModel,
              reason: e.reason,
            });
          },
        });

        send({ type: "phase", phase: "saving_output" });
        const out = await fetchToBuffer(result.imageUrl);

        // Phase 2: extract output colors and compute delta-E vs source.
        const outputColors = await extractDominantColors(out.buffer, 4).catch(
          () => [],
        );
        const comparison =
          sourceColors.length > 0 && outputColors.length > 0
            ? comparePalettes(sourceColors, outputColors)
            : { maxDeltaE: 0, avgDeltaE: 0, matched: [] };

        const resized = await resizeToTarget(out.buffer, profile.target);
        const stored = await saveBufferAsImage(
          resized.buffer,
          resized.mimeType,
          "gen",
        );

        const finalized = await updateGeneration(generation.id, {
          status: "succeeded",
          outputUrl: stored.url,
          model: result.modelUsed,
          falEndpoint: result.endpoint,
          falRequestId: result.requestId,
          falInput: result.input,
          falResponse: result.raw,
          sourceColors,
          outputColors,
          colorMaxDeltaE: comparison.maxDeltaE,
          colorAvgDeltaE: comparison.avgDeltaE,
          completedAt: new Date().toISOString(),
        });
        send({ type: "done", generation: finalized! });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const failed = await updateGeneration(generation.id, {
          status: "failed",
          error: message,
          completedAt: new Date().toISOString(),
        });
        send({ type: "error", message, generation: failed });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
