import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { LISTING_PACKS, type PackPlatform } from "@/lib/listing-packs";
import { getPreset, getSource } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  sourceId: z.string().min(1),
  presetId: z.string().min(1),
  platform: z.enum(["amazon", "shopify", "instagram", "tiktok"]),
  model: z
    .enum(["gpt-image-2", "nano-banana-2", "flux-kontext", "flux-2"])
    .default("gpt-image-2"),
  quality: z.enum(["low", "medium", "high", "auto"]).default("low"),
});

function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

interface PackShotPlanItem {
  packId: string;
  packPlatform: PackPlatform;
  packRole: string;
  packShotIndex: number;
  shotFraming: string;
  sizeProfile: string;
  seed: number;
}

/**
 * Plans a listing pack: returns the packId and the per-shot directives the
 * dashboard will use to fire individual streaming generations. We don't
 * orchestrate the generations server-side because /api/generations is
 * NDJSON-streaming and the client is already wired to consume that stream.
 * The client fires N generations with the same packId + locked seed.
 */
export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { sourceId, presetId, platform, model, quality } = parsed.data;

  const [source, preset] = await Promise.all([
    getSource(sourceId),
    getPreset(presetId),
  ]);
  if (!source) {
    return NextResponse.json({ error: "source not found" }, { status: 404 });
  }
  if (!preset) {
    return NextResponse.json({ error: "preset not found" }, { status: 404 });
  }

  const spec = LISTING_PACKS[platform];
  const packId = nanoid(12);
  const seed = randomSeed();

  const plan: PackShotPlanItem[] = spec.shots.map((shot, i) => ({
    packId,
    packPlatform: platform,
    packRole: shot.role,
    packShotIndex: i,
    shotFraming: shot.framing,
    sizeProfile: shot.sizeProfile,
    seed,
  }));

  return NextResponse.json({
    packId,
    platform,
    model,
    quality,
    seed,
    sourceId,
    presetId,
    shots: plan.map((p, i) => ({
      ...p,
      label: spec.shots[i].label,
    })),
  });
}
