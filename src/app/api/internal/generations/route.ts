import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  addGeneration,
  addSource,
  getPreset,
  updateGeneration,
} from "@/lib/db";
import { constructPrompt } from "@/lib/prompt-construction";
import { generateImage } from "@/lib/image-gen";
import { fetchToBuffer, saveBufferAsImage } from "@/lib/storage";
import { resizeToTarget } from "@/lib/postprocess";
import {
  comparePalettes,
  extractDominantColors,
} from "@/lib/color-extraction";
import { detectFocalPoint } from "@/lib/focal-point";
import { readBearer, verifyVercelOidc } from "@/lib/oidc-verify";
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
  sourceUrl: z.string().url(),
  sourceFilename: z.string().max(256).optional(),
  sourceMimeType: z.string().max(64).optional(),
  presetSlug: z.string().min(1).max(128),
  model: z.enum(["gpt-image-2", "nano-banana-2", "flux-kontext", "flux-2"]),
  sizeProfile: z.string().max(64).optional(),
  quality: z.enum(["low", "medium", "high", "auto"]).optional(),
  seed: z.number().int().nonnegative().optional(),
  shotFraming: z.string().max(2000).optional(),
  callerRef: z.string().max(128).optional(),
});

function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

export async function POST(req: Request) {
  const token = readBearer(req);
  if (!token) {
    return NextResponse.json(
      { error: "missing bearer token" },
      { status: 401 },
    );
  }

  const verified = await verifyVercelOidc(token);
  if (!verified.ok) {
    return NextResponse.json(
      { error: "unauthorized", detail: verified.reason },
      { status: 401 },
    );
  }

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.message },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const preset = await getPreset(input.presetSlug);
  if (!preset) {
    return NextResponse.json(
      { error: `preset not found: ${input.presetSlug}` },
      { status: 404 },
    );
  }

  const profile =
    SIZE_PROFILES.find((p) => p.id === input.sizeProfile) ?? SIZE_PROFILES[0];
  const resolvedSize: ImageSize = profile.nativeSize;
  const resolvedQuality: ImageQuality = input.quality ?? "low";
  const resolvedSizeProfile: SizeProfileId = profile.id;
  const resolvedSeed = input.seed ?? randomSeed();

  const sourceId = nanoid(12);
  await addSource({
    id: sourceId,
    url: input.sourceUrl,
    filename: input.sourceFilename ?? "darkroom-source",
    mimeType: input.sourceMimeType ?? "image/jpeg",
    createdAt: new Date().toISOString(),
  });

  const generation: Generation = {
    id: nanoid(12),
    sourceId,
    presetId: preset.id,
    model: input.model as ImageModelId,
    requestedModel: input.model as ImageModelId,
    size: resolvedSize,
    quality: resolvedQuality,
    sizeProfile: resolvedSizeProfile,
    seed: resolvedSeed,
    status: "pending",
    shotFraming: input.shotFraming,
    createdAt: new Date().toISOString(),
  };
  await addGeneration(generation);

  try {
    await updateGeneration(generation.id, { status: "running" });

    const { buffer: sourceBuf, mimeType: sourceMime } = await fetchToBuffer(
      input.sourceUrl,
    );
    const sourceColors = await extractDominantColors(sourceBuf, 4).catch(
      () => [],
    );

    const constructed = await constructPrompt({
      preset,
      sourceImageBase64: sourceBuf.toString("base64"),
      sourceImageMimeType: sourceMime,
      shotFraming: input.shotFraming,
      sourceColors,
    });
    await updateGeneration(generation.id, {
      constructedPrompt: constructed.prompt,
      register: constructed.register,
    });

    const result = await generateImage({
      model: generation.model,
      prompt: constructed.prompt,
      referenceImageUrls: [input.sourceUrl],
      size: resolvedSize,
      quality: resolvedQuality,
      seed: resolvedSeed,
    });

    const out = await fetchToBuffer(result.imageUrl);
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

    const focal = await detectFocalPoint(resized.buffer, resized.mimeType);

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
      focalPoint: focal.focalPoint,
      faceBox: focal.faceBox,
      completedAt: new Date().toISOString(),
    });

    return NextResponse.json({
      generationId: finalized!.id,
      outputUrl: finalized!.outputUrl,
      register: finalized!.register,
      model: finalized!.model,
      requestedModel: finalized!.requestedModel,
      seed: finalized!.seed,
      colorMaxDeltaE: finalized!.colorMaxDeltaE,
      colorAvgDeltaE: finalized!.colorAvgDeltaE,
      focalPoint: finalized!.focalPoint,
      faceBox: finalized!.faceBox,
      callerProjectId: verified.claims.project_id,
      callerRef: input.callerRef,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateGeneration(generation.id, {
      status: "failed",
      error: message,
      completedAt: new Date().toISOString(),
    });
    return NextResponse.json(
      { error: message, generationId: generation.id },
      { status: 502 },
    );
  }
}
