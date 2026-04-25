import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";

const anthropic = createAnthropic({
  baseURL: "https://api.anthropic.com/v1",
  apiKey: process.env.ANTHROPIC_API_KEY ?? "",
});
import type { Preset } from "./types";
import { describePresetImage } from "./describe-image";

const VISION_MODEL = "claude-sonnet-4-6";
const MAX_REFERENCES_PER_CALL = 8;

const SYSTEM_PROMPT = `You write final image-generation prompts for an image-to-image (edit) endpoint (gpt-image-2 / nano-banana). Your prompts must produce premium, realistic e-commerce lifestyle photographs that PRESERVE the exact garment in a source product photo while placing it into a new scene defined by reference descriptions.

You will receive:
1. A SOURCE image of a garment/product (the user's flat product photo). The output must read as the exact same physical garment.
2. ONE OR MORE textual scene descriptions, each derived from a reference photograph. They define the target scene, lighting, framing, model, and post-processing register.

Your output is ONE single block of natural prose, structured in this order, weaving sentences smoothly. No headings, no bullets, no preamble, no quote marks, no labels. Just the prompt.

Required structure (~350–500 words, written as one paragraph or a few short paragraphs):

1. OPENING SENTENCE — name the register and the brand reference, e.g.:
   "Transform this flat-lay product photo into a premium e-commerce lifestyle photograph in the style of Champion, Carhartt WIP, and Reigning Champ product pages — clean, confident, studio-lifestyle."
   Adapt the brand triad and register to the scene descriptions you've been given (editorial, street, golden-hour, still life, etc.).

2. GARMENT PRESERVATION — describe the SOURCE garment with concrete physical detail extracted from the source image: color and wash, fade pattern if visible, materials and texture, hardware (button color/material, count), stitching color and details, pocket count and exact placement, collar/hem/cuff specifics, any visible branding. Then a sentence: "Do not change the color, the weave, the wash, the stitching, the number of pockets, or [other invariants]." Then: "The [garment type] must read as the exact same physical garment, now being worn in [a studio lifestyle shoot / the scene described]."

3. SCENE — describe how the garment is being worn (open/closed/buttoned/layered), the model (apparent age range, hair, skin, build, posture, facial expression, gaze direction), the backdrop (color, materials, props if any), and the framing (crop, angle, body orientation). Synthesize this from the reference descriptions; do not just quote them.

4. LIGHTING — direction, quality (soft/hard, large source/small source), wrap, fill, color temperature in Kelvin, where shadows fall, ground shadow.

5. QUALITY / RENDERING — describe the photographic register: lens (e.g., "50mm digital photograph"), what should be sharp (stitching, hardware, fabric weave, hair, skin), natural unretouched skin texture (pores, subtle imperfections), realistic fabric drape and weight, authentic wrinkles where the body bends, light on the garment consistent with the scene's light direction, fade pattern following body contours.

6. NEGATIVE DIRECTION — close with: "Match the visual quality of [brand triad] product pages — [register]. Do not make it look like a fashion magazine spread, and do not make it look like a catalog flat or a computer render."

Hard rules:
- Never invent branding or details not visible in the source.
- Never change the source garment's color, wash, weave, stitching, hardware count, pocket count, or collar/hem details.
- Stay grounded in the source image for garment description and in the reference descriptions for scene/light/model.
- Do NOT include text like "Reference 1:", "Source:", or any labels in the output.

CONTENT-SAFETY VOCABULARY (downstream image generators have content checkers that flag certain phrasing even on benign apparel — use commercial-catalog language):
- Describe garments as objects: their material, weave, pattern, color, hardware, construction. Do NOT describe how a garment interacts with the wearer's body, skin, or figure.
- Avoid the words: sheer, see-through, semi-sheer, transparent, peek, peeking, exposed, exposing, reveal, revealing, intimate, lingerie, bare, skin-baring, body-hugging, form-fitting, plunging, low-cut, suggestive.
- For openwork or lace fabrics, say: "open-pattern lace fabric", "openwork knit", "patterned mesh weave", "delicate scalloped trim". Do NOT mention what shows through or what the lining reveals.
- For strapless / shoulderless silhouettes, say: "tube neckline", "horizontal-cut neckline", "shoulderless cut", "above-bust neckline". Do NOT use "strapless" or describe the chest/shoulders/back of the wearer.
- For fitted silhouettes, say: "tailored fit", "structured silhouette", "close cut". Avoid "body-hugging", "form-fitting", "skin-tight".
- Describe the model's pose and framing as standard commercial photography (composed, neutral, looking to camera, three-quarter view). Do NOT describe the model's body shape, curves, or how the garment sits on specific body parts.
- When in doubt, write the way an Amazon, Shopify, or Carhartt WIP catalog page would describe the same garment.`;

function sampleReferences(urls: string[], n: number): string[] {
  if (urls.length <= n) return urls;
  const arr = [...urls];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, n);
}

export async function constructPrompt(args: {
  preset: Preset;
  sourceImageBase64: string;
  sourceImageMimeType: string;
  referenceUrlsOverride?: string[];
}): Promise<string> {
  const { preset, sourceImageBase64, sourceImageMimeType, referenceUrlsOverride } =
    args;

  const pool = referenceUrlsOverride?.length
    ? referenceUrlsOverride
    : preset.referenceImageUrls;
  if (pool.length === 0) {
    throw new Error(
      `Preset "${preset.id}" has no reference images. Add 1+ images to public/presets/${preset.id}/ or select some in the UI.`,
    );
  }

  const sampled = referenceUrlsOverride?.length
    ? referenceUrlsOverride.slice(0, MAX_REFERENCES_PER_CALL)
    : sampleReferences(pool, MAX_REFERENCES_PER_CALL);

  const refDescriptions = await Promise.all(
    sampled.map(async (url) => {
      try {
        const { prompt } = await describePresetImage(url);
        return { url, prompt };
      } catch {
        return { url, prompt: "" };
      }
    }),
  );

  const referenceBlock = refDescriptions
    .filter((r) => r.prompt.length > 0)
    .map((r, i) => `Reference ${i + 1}:\n${r.prompt}`)
    .join("\n\n");

  const userText = `Preset: ${preset.name}
${preset.description}

The attached image is the SOURCE garment to preserve. Below are ${
    refDescriptions.filter((r) => r.prompt.length > 0).length
  } textual scene descriptions derived from reference photographs that define the target visual register. Synthesize them — do not concatenate them verbatim.

${referenceBlock}

Now produce the final image-generation prompt as a single block of natural prose, following the required structure. Output ONLY the prompt.`;

  const { text } = await generateText({
    model: anthropic(VISION_MODEL),
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image" as const,
            image: sourceImageBase64,
            mediaType: sourceImageMimeType,
          },
          { type: "text", text: userText },
        ],
      },
    ],
    maxOutputTokens: 1500,
  });

  return text.trim();
}
