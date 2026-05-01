import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { LISTING_PACKS, type PackPlatform } from "@/lib/listing-packs";
import { getGeneration } from "@/lib/db";
import { planCompleteLookShot } from "@/lib/complete-look";

export const runtime = "nodejs";
export const maxDuration = 120;

const Body = z.object({
  generationId: z.string().min(1),
  platform: z.enum(["amazon", "shopify", "instagram", "tiktok"]),
  model: z
    .enum(["gpt-image-2", "nano-banana-2", "flux-kontext", "flux-2"])
    .default("flux-kontext"),
  quality: z.enum(["low", "medium", "high", "auto"]).default("low"),
});

interface CompleteLookShot {
  packId: string;
  packPlatform: PackPlatform;
  packRole: string;
  packShotIndex: number;
  shotFraming: string;
  sizeProfile: string;
  seed: number;
  label: string;
  prompt: string;
}

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { generationId, platform, model, quality } = parsed.data;

  const parent = await getGeneration(generationId);
  if (!parent) {
    return NextResponse.json({ error: "generation not found" }, { status: 404 });
  }
  if (!parent.outputUrl || parent.status !== "succeeded") {
    return NextResponse.json(
      { error: "parent generation must be completed and have an output" },
      { status: 400 },
    );
  }

  const spec = LISTING_PACKS[platform];
  const packId = nanoid(12);
  const seed = parent.seed ?? Math.floor(Math.random() * 0x7fffffff);

  const shots = await Promise.all(
    spec.shots.map(async (shot, i): Promise<CompleteLookShot> => {
      const { prompt } = await planCompleteLookShot({
        parentImageUrl: parent.outputUrl!,
        shotRole: shot.role,
        shotFraming: shot.framing,
      });
      return {
        packId,
        packPlatform: platform,
        packRole: shot.role,
        packShotIndex: i,
        shotFraming: shot.framing,
        sizeProfile: shot.sizeProfile,
        seed,
        label: shot.label,
        prompt,
      };
    }),
  );

  return NextResponse.json({
    packId,
    platform,
    model,
    quality,
    seed,
    parentGenerationId: parent.id,
    sourceId: parent.sourceId,
    presetId: parent.presetId,
    parentImageUrl: parent.outputUrl,
    shots,
  });
}
