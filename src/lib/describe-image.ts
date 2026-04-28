import { promises as fs } from "node:fs";
import path from "node:path";
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { eq } from "drizzle-orm";
import { getDb, schema } from "./db/client";

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? "",
});

const VISION_MODEL = "gpt-4o";

const SYSTEM_PROMPT = `You write rich, detailed scene descriptions of reference photographs. These descriptions are then synthesized by another model into final image-generation prompts. Be concrete, specific, and grounded in what's actually visible.

You will be given ONE reference image. Produce a single block of prose (no headings, no bullets, no preamble, no quote marks, no labels) covering — in this order, woven into natural sentences:

1. SCENE / BACKDROP — what kind of space is this (studio sweep, interior with hardwood floor, exterior at golden hour, etc.), the colors and textures of the backdrop, any visible props.
2. MODEL (if a person is present) — apparent age range, hair (color, length, style), skin tone if relevant, build, posture, facial expression, where the eyes are looking, hand placement. Describe the type of person, not a specific identifiable individual.
3. WARDROBE / STYLING — the clothing and accessories visible. Note layering, how garments are buttoned/worn/draped.
4. FRAMING — crop (mid-thigh to forehead, hips up, full body, etc.), camera angle (straight-on, three-quarter, slight high/low), body orientation.
5. LIGHTING — direction (overhead, side, behind), quality (soft from a large source, hard from a small source), wrap and fill, where shadows fall, the ground shadow if any. Estimate color temperature in Kelvin (e.g., 3200K warm window light, 5200K neutral studio).
6. POST-PROCESSING / RENDERING REGISTER — does this read as a 50mm digital photograph, a film capture, etc. Skin texture treatment (natural unretouched, retouched). Sharpness focus areas (stitching, hardware, eyes). Depth of field.
7. OVERALL MOOD AND BRAND REGISTER — words like "quiet confident DTC", "editorial", "lived-in", "premium but approachable". Reference brands the image evokes (e.g., Champion, Carhartt WIP, Reigning Champ, Aimé Leon Dore, Buck Mason) only if the image clearly fits that register.

Hard rules:
- Output ONLY the description as one block of natural English. No headings, no bullets, no preamble, no quotes, no labels like "Scene:" or "Lighting:".
- Stay grounded in what's actually visible. Do not invent branding, items, or details that aren't there.
- 250–400 words.`;

async function readImageBytes(url: string): Promise<{
  base64: string;
  mediaType: string;
}> {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status}`);
    const mediaType = res.headers.get("content-type") ?? "image/jpeg";
    const ab = await res.arrayBuffer();
    return { base64: Buffer.from(ab).toString("base64"), mediaType };
  }
  const fsPath = path.join(process.cwd(), "public", url.replace(/^\//, ""));
  const buf = await fs.readFile(fsPath);
  const ext = path.extname(fsPath).toLowerCase();
  const mediaType =
    ext === ".png"
      ? "image/png"
      : ext === ".webp"
        ? "image/webp"
        : ext === ".gif"
          ? "image/gif"
          : "image/jpeg";
  return { base64: buf.toString("base64"), mediaType };
}

/**
 * Describe a preset reference image. Cache lives on the preset_image row's
 * `cached_prompt` column, keyed by the image URL (typically a Vercel Blob URL).
 *
 * Falls back to filesystem read for legacy `/presets/...` URLs that pre-date
 * the DB migration.
 */
export async function describePresetImage(
  url: string,
  opts: { force?: boolean } = {},
): Promise<{ prompt: string; cached: boolean }> {
  const db = getDb();

  const existing = await db
    .select()
    .from(schema.presetImage)
    .where(eq(schema.presetImage.url, url));

  const row = existing[0];

  if (!opts.force && row?.cachedPrompt) {
    return { prompt: row.cachedPrompt, cached: true };
  }

  const { base64, mediaType } = await readImageBytes(url);
  const { text } = await generateText({
    model: openai(VISION_MODEL),
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          { type: "image" as const, image: base64, mediaType },
          {
            type: "text",
            text: "Describe this reference image as a single-block image-generation prompt as instructed.",
          },
        ],
      },
    ],
    maxOutputTokens: 1000,
  });
  const prompt = text.trim();

  if (row) {
    await db
      .update(schema.presetImage)
      .set({ cachedPrompt: prompt })
      .where(eq(schema.presetImage.id, row.id));
  }

  return { prompt, cached: false };
}
