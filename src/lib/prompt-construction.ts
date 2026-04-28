import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { Preset, RegisterConfig, RegisterId } from "./types";
import { REGISTERS } from "./types";
import { describePresetImage } from "./describe-image";
import type { ColorSwatch } from "./color-extraction";
import { describeForPrompt } from "./color-extraction";

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? "",
});

const VISION_MODEL = "gpt-4o";
const MAX_REFERENCES_PER_CALL = 4;

function buildSystemPrompt(register: RegisterConfig): string {
  return `You write final image-generation prompts for an image-to-image (edit) endpoint (gpt-image-2 / nano-banana / flux-kontext / flux-2). Your prompts must produce HYPERREALISTIC e-commerce lifestyle photographs in the ${register.label} register, while preserving the exact garment from a source product photo.

You will be given:
1. ONE source image of a garment (the user's product). Treat it as the immutable subject.
2. ONE OR MORE textual scene descriptions, each derived from a reference photograph.

Your output is ONE single block of natural prose, structured as one paragraph or a few short paragraphs. No headings, no bullets, no preamble, no quote marks, no labels. Just the prompt itself.

Required structure (~450–650 words):

1. OPENING SENTENCE — name the register and brand reference: "Transform this flat-lay product photo into a hyperrealistic ${register.label.toLowerCase()} photograph in the style of ${register.brandTriad} product pages — captured as a real moment with a real camera."

2. GARMENT PRESERVATION — this section is FORENSIC. The image generator will use this description to reconstruct the same exact garment on a model — every detail you omit will be re-imagined incorrectly. You must inventory the source image and call out, with specific counts and exact descriptions:
   - The garment category and silhouette (e.g., "a Western-style trucker denim jacket with a slim-cropped fit ending at the high hip").
   - Exact color and wash: not "blue denim" but "medium-indigo cotton denim in a stonewash finish with concentrated whisker fading along the chest, vertical fade lines on the body, and lighter abrasion on the cuff edges and pocket flaps". Name the wash style (raw / rinse / mid-wash / stonewash / acid / black-stone).
   - Button count, color, finish, and placement: "five matte-brass shank buttons down the front placket spaced approximately 7cm apart; one matte-brass shank button on each chest pocket flap; one matte-brass shank button on each cuff. Total of nine buttons in matching matte-brass."
   - Pocket configuration: "two chest patch pockets with pointed-bottom flaps, each with a single button closure; no welt pockets at the waist; no interior pockets visible."
   - Stitching: color, pattern, and density. "Burnt-orange double-needle topstitching at every seam, including the side body seams, the yoke, the pocket borders, the placket, the collar fold, the cuff, and the hem band. Two parallel rows of stitching spaced ~5mm apart."
   - Construction details: yoke shape (Western-curved chest yoke / straight yoke / no yoke), back panel (single-piece / two-piece with center seam / pleated), collar shape (pointed / spread / mandarin), cuff style (single-button / two-button / extended placket).
   - Branding visible in the source: read every label, hangtag, woven patch, embroidery, leather patch — quote the exact text. If a brand is "OLD NAVY" on the inner label, say so. If no exterior branding is visible on the body, say so explicitly: "no exterior branding, embroidery, or printed graphics on the front, back, sleeves, or chest."
   - Wear and condition cues: any pulls, fraying, repairs, distressing, fading patterns; if the garment is brand-new and unworn, say so.
   Then end the block with the hard preservation directive (verbatim, do not paraphrase): "Do not redesign, redraw, restyle, recolor, or substitute any part of this garment. The button count is fixed, the pocket configuration is fixed, the stitching color and pattern are fixed, the wash and fade pattern are fixed, the silhouette and length are fixed, the collar and cuff styles are fixed. The model is wearing this exact garment — not a similar one, not a 'representative example' — the same physical piece, transferred onto a body in the scene described."

3. SCENE — describe how the garment is being worn (open/closed/buttoned/layered), the model (apparent age range, hair, skin tone, build, posture, facial expression with a specific naturalistic nuance), the backdrop, and the framing. Pose register for THIS prompt: ${register.poseLanguage}.

4. LIGHTING — ${register.lighting}.

5. QUALITY / RENDERING — be specific and dense. Include all of:
   - Camera and lens: a real specific body + lens at a specific aperture (e.g., "shot on a Sony A7IV with an 85mm f/1.4 GM lens at f/2.0, ISO 400, 1/250s" or "Fujifilm X-T5 with the 56mm f/1.2 at f/2.0"). Pick what fits the register and scene.
   - Framing: ${register.framing}.
   - SKIN — RAW UNRETOUCHED PHOTOGRAPHY (this is non-negotiable; lead the rendering description with this): visible pore texture across forehead, nose, T-zone, cheeks, and chin; fine vellus / peach-fuzz hair on the upper lip and along the jawline catching light; subtle redness in capillary regions (around the nostrils, inner corners of the eyes, the bridge of the nose, the cupid's bow); micro-creases at the outer corners of the eyes and below the lower lash line when the expression is relaxed; individual eyebrow hairs not airbrushed; natural lip texture with small vertical grooves and slightly varied color (NOT lipstick-uniform); a single small natural mark — a freckle, faint mole, tiny scar, or a small acne mark — placed where it would naturally occur. Skin tone has the warmth of real subsurface blood and faint blue-green undertones in shadowed areas. ABSOLUTELY NO airbrushing, NO beauty filter, NO digital skin smoothing, NO glossy plastic finish, NO perfectly even tone — the skin must read as a real human being photographed without retouching, the way it appears in raw editorial photography (Wolfgang Tillmans, Juergen Teller, Tyrone Lebon style). If the skin in the output looks smooth, plastic, glossy, airbrushed, or uniformly toned, this is a failure.
   - Skin treatment for THIS register (apply on top of the raw-skin baseline above): ${register.skinTreatment}.
   - Hair: individual strands visible, a few natural flyaways at the hairline and crown, scalp visible at the part where natural, color variation between roots and ends.
   - Subsurface scattering in lit skin (warm translucency through ears, lids, fingertips); micro-shadows under nose, chin, lip, lashes.
   - Fabric: realistic drape with authentic creases where the body bends, thread-level texture on knits and wovens, weave-level highlights where light grazes the surface, hardware highlights consistent with light direction.
   - Environment: real-world imperfections in the backdrop (a small scuff, a dust mote, a slightly uneven seam), authentic bokeh that is NOT perfectly creamy — slight cat's-eye distortion at the edges of the frame, subtle chromatic aberration in highlights, gentle optical vignette.
   - Color science: film-like rolloff in highlights, restrained saturation, true skin tones with the warmth of subsurface blood, faint cool or green cast in shadows depending on the actual light source.
   - One or two atmospheric tells of a real captured moment (a single dust mote suspended in a light beam, faint motion blur on a moving strand of hair, a fingerprint smudge on a surface).

6. CLOSING / NEGATIVE DIRECTION — close with: "${register.closingLine.replace("[BRAND_TRIAD]", register.brandTriad)} AVOID THE AI LOOK: avoid plastic-smooth skin, perfectly symmetrical features, idealized model-agency faces, glossy airbrushed cheeks, overly clean bokeh, identical pupil reflections, impossibly even lighting, identical-twin facial proportions, any sense of digital perfection. The output must look like a real photograph of a real human being captured by a real photographer in a real moment. Do not make it look like a fashion magazine spread, do not make it look like a catalog flat, and absolutely do not make it look like a render or AI image."

Hard rules:
- Never invent branding or details not visible in the source.
- Never change the source garment's color, weave, stitching, hardware count, or pocket count.
- Stay grounded in the source image for garment description and in the reference descriptions for scene/light/model.
- Do NOT include text like "Reference 1:", "Source:", or any labels in the output.
- Write the way a top-tier e-commerce or campaign brand would write internally for their photographer.`;
}

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
  register?: RegisterId;
  /** Optional override for the framing language. Used by listing-pack shots
   * to vary angle/crop while keeping the rest of the scene constant. */
  shotFraming?: string;
  /** Pre-extracted dominant colors of the source garment (HEX + RGB).
   * Injected as explicit values so the image generator has hard targets,
   * not interpretive prose. Phase 1 of color verification. */
  sourceColors?: ColorSwatch[];
}): Promise<string> {
  const {
    preset,
    sourceImageBase64,
    sourceImageMimeType,
    referenceUrlsOverride,
    register,
    shotFraming,
    sourceColors,
  } = args;

  const registerConfig =
    REGISTERS.find((r) => r.id === register) ?? REGISTERS[0];

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

  const framingDirective = shotFraming
    ? `

REQUIRED FRAMING for this specific shot (this OVERRIDES whatever framing the references suggest — write Section 5's "Framing" sub-line to match this exactly): ${shotFraming}`
    : "";

  const colorDirective =
    sourceColors && sourceColors.length > 0
      ? `

REQUIRED COLOR ANCHORS (extracted from the source image — these are the actual pixel values to render, NOT interpretive prose): ${describeForPrompt(
          sourceColors,
        )}. Write the GARMENT PRESERVATION block so it explicitly names these HEX values for the corresponding garment regions (body color, hardware accent, fade highlights, lining, contrast stitching, etc., as applicable). Do not paraphrase the colors — quote the HEX strings verbatim. The image generator must land on these exact values; any color shift greater than ~10 ΔE is a failure.`
      : "";

  const userText = `Preset: ${preset.name}
${preset.description}
Register: ${registerConfig.label} — ${registerConfig.hint}${framingDirective}${colorDirective}

The attached image is the SOURCE garment to preserve. Below are ${
    refDescriptions.filter((r) => r.prompt.length > 0).length
  } textual scene descriptions derived from reference photographs that define the target visual register. Synthesize them — do not concatenate them verbatim.

${referenceBlock}

Now produce the final image-generation prompt as a single block of natural prose, in the ${registerConfig.label} register, following the required structure. Output ONLY the prompt.`;

  const { text } = await generateText({
    model: openai(VISION_MODEL),
    system: buildSystemPrompt(registerConfig),
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
