import { fal } from "@fal-ai/client";
import type { ImageModelId, ImageQuality, ImageSize } from "./types";

if (process.env.FAL_KEY) {
  fal.config({ credentials: process.env.FAL_KEY });
}

const MODEL_ENDPOINTS: Record<ImageModelId, string> = {
  "gpt-image-2": "openai/gpt-image-2/edit",
  "nano-banana-2": "fal-ai/nano-banana/edit",
  "flux-kontext": "fal-ai/flux-pro/kontext",
};

export type FalProgressEvent =
  | { type: "queued"; position?: number }
  | { type: "in_progress"; logs?: string[] }
  | { type: "completed" };

export interface GenerateImageInput {
  model: ImageModelId;
  prompt: string;
  referenceImageUrls: string[];
  size?: ImageSize;
  quality?: ImageQuality;
  seed?: number;
  onProgress?: (event: FalProgressEvent) => void;
}

export interface GenerateImageOutput {
  imageUrl: string;
  contentType: string;
  raw: unknown;
}

interface FalImageResult {
  images?: Array<{ url: string; content_type?: string }>;
  image?: { url: string; content_type?: string };
}

interface FalQueueUpdate {
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";
  queue_position?: number;
  logs?: Array<{ message?: string }>;
}

const FALLBACK_CHAIN: Record<ImageModelId, ImageModelId[]> = {
  "gpt-image-2": ["gpt-image-2", "nano-banana-2", "flux-kontext"],
  "nano-banana-2": ["nano-banana-2", "flux-kontext"],
  "flux-kontext": ["flux-kontext"],
};

const SIZE_TO_ASPECT_RATIO: Record<ImageSize, string> = {
  "1024x1024": "1:1",
  "1024x1536": "2:3",
  "1536x1024": "3:2",
  auto: "1:1",
};

function buildModelInput(
  model: ImageModelId,
  input: GenerateImageInput,
): Record<string, unknown> {
  const aspectRatio = SIZE_TO_ASPECT_RATIO[input.size ?? "1024x1024"];

  if (model === "gpt-image-2") {
    return {
      prompt: input.prompt,
      image_urls: input.referenceImageUrls,
      image_size: input.size ?? "auto",
      quality: input.quality ?? "high",
      num_images: 1,
      ...(typeof input.seed === "number" ? { seed: input.seed } : {}),
    };
  }

  if (model === "nano-banana-2") {
    return {
      prompt: input.prompt,
      image_urls: input.referenceImageUrls,
      num_images: 1,
      ...(typeof input.seed === "number" ? { seed: input.seed } : {}),
    };
  }

  // flux-kontext takes a SINGLE image_url and aspect_ratio + safety_tolerance.
  return {
    prompt: input.prompt,
    image_url: input.referenceImageUrls[0],
    aspect_ratio: aspectRatio,
    num_images: 1,
    safety_tolerance: "6",
    output_format: "png",
    ...(typeof input.seed === "number" ? { seed: input.seed } : {}),
  };
}

interface FalLikeError {
  status?: number;
  body?: { detail?: unknown };
  message?: string;
}

function isFilterError(err: unknown): boolean {
  const e = err as FalLikeError;
  if (e?.status === 422) return true;
  const message = (e?.message ?? "").toLowerCase();
  if (message.includes("content checker")) return true;
  if (message.includes("content_policy")) return true;
  if (message.includes("unprocessable entity")) return true;
  if (message.includes("flagged by")) return true;
  const detail = JSON.stringify(e?.body?.detail ?? "").toLowerCase();
  if (detail.includes("content")) return true;
  if (detail.includes("flagged")) return true;
  if (detail.includes("policy")) return true;
  return false;
}

async function generateOnce(
  model: ImageModelId,
  input: GenerateImageInput,
): Promise<GenerateImageOutput> {
  const endpoint = MODEL_ENDPOINTS[model];
  const { onProgress } = input;
  let lastLogCount = 0;

  const result = await fal.subscribe(endpoint, {
    input: buildModelInput(model, input),
    logs: true,
    onQueueUpdate: (update: FalQueueUpdate) => {
      if (!onProgress) return;
      if (update.status === "IN_QUEUE") {
        onProgress({ type: "queued", position: update.queue_position });
      } else if (update.status === "IN_PROGRESS") {
        const logs = update.logs ?? [];
        const fresh = logs.slice(lastLogCount);
        lastLogCount = logs.length;
        onProgress({
          type: "in_progress",
          logs: fresh
            .map((l) => l.message ?? "")
            .filter((m): m is string => Boolean(m)),
        });
      } else if (update.status === "COMPLETED") {
        onProgress({ type: "completed" });
      }
    },
  });

  const data = result.data as FalImageResult;
  const first = data.images?.[0] ?? data.image;
  if (!first?.url) {
    throw new Error(
      `fal endpoint ${endpoint} returned no image. Raw: ${JSON.stringify(data).slice(0, 400)}`,
    );
  }

  return {
    imageUrl: first.url,
    contentType: first.content_type ?? "image/png",
    raw: result.data,
  };
}

export interface FallbackEvent {
  fromModel: ImageModelId;
  toModel: ImageModelId;
  reason: string;
}

export async function generateImage(
  input: GenerateImageInput & {
    onFallback?: (event: FallbackEvent) => void;
  },
): Promise<GenerateImageOutput & { modelUsed: ImageModelId }> {
  const chain = FALLBACK_CHAIN[input.model] ?? [input.model];
  let lastError: unknown;

  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    try {
      const result = await generateOnce(model, input);
      return { ...result, modelUsed: model };
    } catch (err) {
      lastError = err;
      const isFilter = isFilterError(err);
      const hasNext = i + 1 < chain.length;
      if (!isFilter || !hasNext) {
        throw err;
      }
      const next = chain[i + 1];
      const message =
        err instanceof Error ? err.message : String(err);
      input.onFallback?.({
        fromModel: model,
        toModel: next,
        reason: message.slice(0, 200),
      });
    }
  }

  throw lastError;
}
