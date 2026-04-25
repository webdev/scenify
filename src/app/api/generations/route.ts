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
import { predictGptImageRejection } from "@/lib/safety-prediction";
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
  model: z.enum(["gpt-image-2", "nano-banana-2", "flux-kontext"]),
  referenceUrls: z.array(z.string()).optional(),
  sizeProfile: z.string().optional(),
  quality: z.enum(["low", "medium", "high", "auto"]).optional(),
  seed: z.number().int().nonnegative().optional(),
  reusePromptFromGenerationId: z.string().optional(),
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
    reusePromptFromGenerationId,
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
  if (reusePromptFromGenerationId) {
    const { getGeneration } = await import("@/lib/db");
    const prior = await getGeneration(reusePromptFromGenerationId);
    if (prior?.constructedPrompt) {
      reusedConstructedPrompt = prior.constructedPrompt;
      reusedSeed = prior.seed;
    }
  }

  const resolvedSeed: number = seed ?? reusedSeed ?? randomSeed();

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
    status: "pending",
    constructedPrompt: reusedConstructedPrompt,
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

        let constructedPrompt: string;
        if (reusedConstructedPrompt) {
          constructedPrompt = reusedConstructedPrompt;
          send({ type: "prompt", constructedPrompt });
        } else {
          send({ type: "phase", phase: "fetching_source" });
          const { buffer, mimeType } = await fetchToBuffer(sourceAbsolute);
          const imageBase64 = buffer.toString("base64");

          send({ type: "phase", phase: "constructing_prompt" });
          constructedPrompt = await constructPrompt({
            preset,
            sourceImageBase64: imageBase64,
            sourceImageMimeType: mimeType,
            referenceUrlsOverride: referenceUrls,
          });
          await updateGeneration(generation.id, { constructedPrompt });
          send({ type: "prompt", constructedPrompt });
        }

        let effectiveModel: ImageModelId = generation.model;
        if (effectiveModel === "gpt-image-2") {
          const prediction = predictGptImageRejection(constructedPrompt);
          if (prediction.risky) {
            effectiveModel = "nano-banana-2";
            send({
              type: "model_routed",
              fromModel: generation.model,
              toModel: effectiveModel,
              matched: prediction.matched,
            });
            await updateGeneration(generation.id, { model: effectiveModel });
          }
        }

        send({ type: "phase", phase: "calling_fal" });
        const result = await generateImage({
          model: effectiveModel,
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
