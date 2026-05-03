import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import type { FaceBox, FocalPoint, Generation } from "./types";

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? "",
});

const VISION_MODEL = "gpt-4o";

export interface FocalPointResult {
  focalPoint: FocalPoint;
  faceBox: FaceBox | null;
}

export const CENTER_FOCAL_POINT: FocalPoint = {
  x: 0.5,
  y: 0.5,
  confidence: 1,
  source: "center",
};

export function withFocalDefaults<T extends Pick<Generation, "focalPoint" | "faceBox">>(
  g: T,
): T & { focalPoint: FocalPoint; faceBox: FaceBox | null } {
  return {
    ...g,
    focalPoint: g.focalPoint ?? CENTER_FOCAL_POINT,
    faceBox: g.faceBox ?? null,
  };
}

const Schema = z.object({
  hasFace: z
    .boolean()
    .describe(
      "True only if a human face is clearly visible. False for product-only or non-human shots.",
    ),
  faceBox: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      width: z.number().min(0).max(1),
      height: z.number().min(0).max(1),
      confidence: z.number().min(0).max(1),
    })
    .nullable()
    .describe(
      "Normalized 0..1 bounding box of the dominant subject's face. Null if no face. If multiple faces, return the largest/most-central one.",
    ),
  focalX: z
    .number()
    .min(0)
    .max(1)
    .describe(
      "Normalized 0..1 x of the focal point. For human shots this is the face center; for product shots it is the salient subject center; otherwise 0.5.",
    ),
  focalY: z.number().min(0).max(1),
  focalConfidence: z
    .number()
    .min(0)
    .max(1)
    .describe(
      "0..1 confidence in the focal point. <0.5 means consumers should fall back to image center.",
    ),
  focalSource: z
    .enum(["face", "saliency", "center"])
    .describe(
      "How the focal point was derived. 'face' if anchored on a detected face; 'saliency' for product-only shots; 'center' if uncertain.",
    ),
});

const SYSTEM_PROMPT = `You analyze a single output image and return a focal point and (if applicable) the dominant subject's face bounding box, both in normalized 0..1 coordinates relative to the image's natural width and height.

Rules:
- If a clear human face is visible, set hasFace=true and faceBox to the largest/most-central face. focalSource="face" and focalX/focalY land on the face center (between the eyes, slightly above the nose).
- If no face is present but there is an obvious salient subject (product, garment, single object), focalSource="saliency" and focalX/focalY mark the subject's visual center of mass. faceBox=null.
- If neither a face nor a clear salient subject is detected, return focalSource="center", focalX=0.5, focalY=0.5, faceBox=null, focalConfidence<=0.4.
- Do NOT invent a face. If you are unsure, set hasFace=false.
- Coordinates are 0..1 with origin at the top-left of the image.`;

export async function detectFocalPoint(
  imageBuffer: Buffer,
  mimeType: string = "image/png",
): Promise<FocalPointResult> {
  try {
    const { object } = await generateObject({
      model: openai(VISION_MODEL),
      schema: Schema,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              image: imageBuffer,
              mediaType: mimeType,
            },
            {
              type: "text",
              text: "Return the focal point and face box for this image.",
            },
          ],
        },
      ],
    });

    const focalPoint: FocalPoint = {
      x: object.focalX,
      y: object.focalY,
      confidence: object.focalConfidence,
      source: object.focalSource,
    };

    const faceBox: FaceBox | null =
      object.hasFace && object.faceBox && object.faceBox.confidence >= 0.5
        ? object.faceBox
        : null;

    return { focalPoint, faceBox };
  } catch {
    return { focalPoint: CENTER_FOCAL_POINT, faceBox: null };
  }
}
