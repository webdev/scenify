import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";

const anthropic = createAnthropic({
  baseURL: "https://api.anthropic.com/v1",
  apiKey: process.env.ANTHROPIC_API_KEY ?? "",
});

const VISION_MODEL = "claude-sonnet-4-6";
const CACHE_DIR = path.join(process.cwd(), "data", "preset-prompts");

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
- 250–400 words.

CONTENT-SAFETY VOCABULARY (downstream image generators have content checkers that flag certain phrasing even on benign apparel — use commercial-catalog language):
- Describe clothing as objects: material, weave, pattern, hardware, construction. Do NOT describe how a garment interacts with the wearer's body, skin, or figure.
- Avoid the words: sheer, see-through, semi-sheer, transparent, peek, peeking, exposed, exposing, reveal, revealing, intimate, lingerie, bare, skin-baring, body-hugging, form-fitting, plunging, low-cut, suggestive.
- For openwork or lace fabrics, say "open-pattern lace fabric" or "patterned mesh weave"; do not mention what shows through.
- For strapless or shoulderless cuts, say "tube neckline" or "shoulderless cut"; do not say "strapless" or describe shoulders/chest/back.
- Describe the model's pose and framing in standard commercial-photography terms (composed, looking to camera, three-quarter view). Do not describe body shape, curves, or how a garment sits on specific body parts.
- Write the way an Amazon, Shopify, or Carhartt WIP catalog page would describe the same image.`;

function cacheKey(url: string): string {
  return crypto.createHash("sha1").update(url).digest("hex");
}

async function readCache(key: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(CACHE_DIR, `${key}.txt`), "utf8");
  } catch {
    return null;
  }
}

async function writeCache(key: string, text: string): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(path.join(CACHE_DIR, `${key}.txt`), text, "utf8");
}

async function readImageFromPublic(relativeUrl: string): Promise<{
  base64: string;
  mediaType: string;
}> {
  const fsPath = path.join(
    process.cwd(),
    "public",
    relativeUrl.replace(/^\//, ""),
  );
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

export async function describePresetImage(
  relativeUrl: string,
  opts: { force?: boolean } = {},
): Promise<{ prompt: string; cached: boolean }> {
  const key = cacheKey(relativeUrl);
  if (!opts.force) {
    const hit = await readCache(key);
    if (hit) return { prompt: hit, cached: true };
  }

  const { base64, mediaType } = await readImageFromPublic(relativeUrl);
  const { text } = await generateText({
    model: anthropic(VISION_MODEL),
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
  await writeCache(key, prompt);
  return { prompt, cached: false };
}
