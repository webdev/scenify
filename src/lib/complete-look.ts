import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? "",
});

const VISION_MODEL = "gpt-4o";

const SYSTEM_PROMPT = `You write image-to-image continuation prompts for fashion / e-commerce shoots.

A model has just generated a lifestyle product photo. You are now planning a follow-up shot of the SAME model wearing the SAME garment, in the SAME setting, with a DIFFERENT pose / framing. The downstream image model receives this prompt plus the original render as a visual seed; your job is to lock identity and let only the framing change.

Output a single dense paragraph — no preamble, no headings, no quote marks, no bullets — that:

1. Opens with "Continue the same lookbook using the exact same model wearing the exact same garment."
2. Locks model identity verbatim: same face, same hair (color, length, style), same skin tone, same body proportions, same age, same expression direction. Use a short specific list grounded in what is visible — e.g. "warm-brown skin, close-cropped black hair, soft-set jawline, calm direct gaze".
3. Locks garment identity forensically: name the garment type, then call out its specific construction details (collar/lapel shape, button or zipper count and material, pocket configuration, stitching color and density, hardware, branding text, fabric texture, exact color). The downstream model must not redesign a single detail.
4. Locks the scene aesthetic: same backdrop, same furniture/props if any, same lighting direction and color temperature, same overall color palette and mood.
5. States the new framing for THIS shot using the SHOT FRAMING block as a starting point, but ALWAYS soften the crop. Add explicit breathing room: keep the entire head visible from the crown of the hair to the chin (never crop the top of the head), keep both hands in frame whenever the pose has them at the sides or on the body, and for any "full-body" framing keep the shoes and a strip of ground visible below the feet. Add at least 8–12% negative space on the top edge and the side the body leans toward. If the SHOT FRAMING block describes a tight crop (e.g. "mid-thigh up", "extreme close-up"), pull the camera back slightly and re-state the crop one body-section wider — e.g. mid-thigh becomes knee-up, extreme close-up becomes medium close-up with the hand and surrounding context visible.
6. For detail shots, describe the close-up but explicitly include: the framing must NOT clip body parts at awkward joints (no crops at the wrist, elbow, knee, or neck); always crop through soft mid-segments (mid-forearm, mid-thigh) with surrounding context visible.
7. Ends with: "Do not redesign the model. Do not redesign the garment. Frame with generous breathing room — do not crop the head, hands, or feet aggressively. Photographic continuity with the reference image is paramount. No text. No watermark."

Be SUPER specific. The goal is a render that is indistinguishable from a sibling frame in the same shoot — composed by a real photographer who would never amputate a head or hands at the edge of frame.`;

export async function planCompleteLookShot(opts: {
  parentImageUrl: string;
  shotRole: string;
  shotFraming: string;
}): Promise<{ prompt: string }> {
  const { object } = await generateObject({
    model: openai(VISION_MODEL),
    schema: z.object({
      prompt: z.string().min(40),
    }),
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "REFERENCE RENDER (the existing shot to continue from — match its model, garment, and scene exactly):",
          },
          { type: "image", image: opts.parentImageUrl },
          {
            type: "text",
            text: `SHOT ROLE: ${opts.shotRole}\nSHOT FRAMING: ${opts.shotFraming}\n\nWrite the continuation prompt now.`,
          },
        ],
      },
    ],
  });

  return { prompt: object.prompt };
}
