import { NextResponse } from "next/server";
import { after } from "next/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  addGeneration,
  getGeneration,
  updateGeneration,
} from "@/lib/db";
import { generateImage } from "@/lib/image-gen";
import { fetchToBuffer, saveBufferAsImage } from "@/lib/storage";
import { resizeToTarget } from "@/lib/postprocess";
import {
  comparePalettes,
  extractDominantColors,
} from "@/lib/color-extraction";
import { readBearer, verifyVercelOidc } from "@/lib/oidc-verify";
import { LISTING_PACKS, type PackPlatform } from "@/lib/listing-packs";
import { planCompleteLookShot } from "@/lib/complete-look";
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
  parentGenerationId: z.string().min(1),
  platform: z.enum(["amazon", "shopify", "instagram", "tiktok"]),
  model: z
    .enum(["gpt-image-2", "nano-banana-2", "flux-kontext", "flux-2"])
    .default("flux-kontext"),
  quality: z.enum(["low", "medium", "high", "auto"]).optional(),
  callerRef: z.string().max(256).optional(),
});

interface PlannedShot {
  generationId: string;
  packRole: string;
  packShotIndex: number;
  shotFraming: string;
  sizeProfile: SizeProfileId;
  label: string;
  prompt: string;
}

async function executeShot(opts: {
  shot: PlannedShot;
  parent: Generation;
  parentImageUrl: string;
  model: ImageModelId;
  quality: ImageQuality;
  seed: number;
}): Promise<void> {
  const { shot, parent, parentImageUrl, model, quality, seed } = opts;
  const profile =
    SIZE_PROFILES.find((p) => p.id === shot.sizeProfile) ?? SIZE_PROFILES[0];
  const resolvedSize: ImageSize = profile.nativeSize;

  try {
    await updateGeneration(shot.generationId, { status: "running" });

    const { buffer: parentBuf } = await fetchToBuffer(parentImageUrl);
    const parentColors = await extractDominantColors(parentBuf, 4).catch(
      () => [],
    );

    const result = await generateImage({
      model,
      prompt: shot.prompt,
      referenceImageUrls: [parentImageUrl],
      size: resolvedSize,
      quality,
      seed,
    });

    const out = await fetchToBuffer(result.imageUrl);
    const outputColors = await extractDominantColors(out.buffer, 4).catch(
      () => [],
    );
    const comparison =
      parentColors.length > 0 && outputColors.length > 0
        ? comparePalettes(parentColors, outputColors)
        : { maxDeltaE: 0, avgDeltaE: 0, matched: [] };

    const resized = await resizeToTarget(out.buffer, profile.target);
    const stored = await saveBufferAsImage(
      resized.buffer,
      resized.mimeType,
      "gen",
    );

    await updateGeneration(shot.generationId, {
      status: "succeeded",
      outputUrl: stored.url,
      model: result.modelUsed,
      falEndpoint: result.endpoint,
      falRequestId: result.requestId,
      falInput: result.input,
      falResponse: result.raw,
      sourceColors: parentColors,
      outputColors,
      colorMaxDeltaE: comparison.maxDeltaE,
      colorAvgDeltaE: comparison.avgDeltaE,
      completedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateGeneration(shot.generationId, {
      status: "failed",
      error: message,
      completedAt: new Date().toISOString(),
    });
    // Suppress — caller already returned. Status surfaces via the GET poll.
    void parent;
  }
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
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { parentGenerationId, platform, model, quality, callerRef } =
    parsed.data;

  const parent = await getGeneration(parentGenerationId);
  if (!parent) {
    return NextResponse.json(
      { error: "parent generation not found" },
      { status: 404 },
    );
  }
  if (parent.status !== "succeeded" || !parent.outputUrl) {
    return NextResponse.json(
      { error: "parent generation must be succeeded with an output" },
      { status: 400 },
    );
  }

  const spec = LISTING_PACKS[platform];
  const packId = nanoid(12);
  const seed = parent.seed ?? Math.floor(Math.random() * 0x7fffffff);
  const resolvedQuality: ImageQuality = quality ?? parent.quality;

  // Plan + persist all rows synchronously so the response carries real
  // generationIds the caller can poll. The actual fal calls run after the
  // response via after(); the function instance keeps running until they
  // settle (Fluid Compute handles this within maxDuration).
  const planned: PlannedShot[] = await Promise.all(
    spec.shots.map(async (shot, i): Promise<PlannedShot> => {
      const { prompt } = await planCompleteLookShot({
        parentImageUrl: parent.outputUrl!,
        shotRole: shot.role,
        shotFraming: shot.framing,
      });
      const profile =
        SIZE_PROFILES.find((p) => p.id === shot.sizeProfile) ??
        SIZE_PROFILES[0];
      const generation: Generation = {
        id: nanoid(12),
        sourceId: parent.sourceId,
        presetId: parent.presetId,
        model,
        requestedModel: model,
        size: profile.nativeSize,
        quality: resolvedQuality,
        sizeProfile: profile.id,
        seed,
        register: parent.register,
        status: "pending",
        constructedPrompt: prompt,
        packId,
        packPlatform: platform,
        packRole: shot.role,
        packShotIndex: i,
        shotFraming: shot.framing,
        parentGenerationId: parent.id,
        createdAt: new Date().toISOString(),
      };
      await addGeneration(generation);
      return {
        generationId: generation.id,
        packRole: shot.role,
        packShotIndex: i,
        shotFraming: shot.framing,
        sizeProfile: shot.sizeProfile,
        label: shot.label,
        prompt,
      };
    }),
  );

  // Fire fal calls after the response is sent. They run in parallel; each
  // updates its own row to succeeded/failed. Vesperdrop polls
  // GET /api/internal/complete-look/<packId> for status.
  after(async () => {
    await Promise.all(
      planned.map((shot) =>
        executeShot({
          shot,
          parent,
          parentImageUrl: parent.outputUrl!,
          model,
          quality: resolvedQuality,
          seed,
        }),
      ),
    );
  });

  return NextResponse.json({
    packId,
    parentGenerationId: parent.id,
    platform,
    seed,
    model,
    quality: resolvedQuality,
    statusUrl: `/api/internal/complete-look/${packId}`,
    shots: planned.map((s) => ({
      generationId: s.generationId,
      role: s.packRole,
      label: s.label,
      shotIndex: s.packShotIndex,
      sizeProfile: s.sizeProfile,
      status: "pending",
    })),
    callerProjectId: verified.claims.project_id,
    callerRef,
  });
}
