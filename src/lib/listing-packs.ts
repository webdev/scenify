import type { SizeProfileId } from "./types";

export type PackPlatform = "amazon" | "shopify" | "instagram" | "tiktok";

export type ShotRole =
  | "hero"
  | "three-quarter"
  | "profile"
  | "full-body"
  | "back"
  | "detail-hardware"
  | "detail-fabric";

export interface ShotSpec {
  role: ShotRole;
  label: string;
  /** Injected into the SCENE/FRAMING section of the constructed prompt. */
  framing: string;
  sizeProfile: SizeProfileId;
}

export interface PackSpec {
  platform: PackPlatform;
  label: string;
  hint: string;
  shots: ShotSpec[];
}

export const LISTING_PACKS: Record<PackPlatform, PackSpec> = {
  amazon: {
    platform: "amazon",
    label: "Amazon Apparel",
    hint: "1 main + 3 lifestyle + 2 detail. 2048×2048 square.",
    shots: [
      {
        role: "hero",
        label: "Main hero",
        framing:
          "front-facing three-quarter body crop from mid-thigh up to just above the head, body squared to camera with a subtle three-quarter rotation, eye-level, model looking directly into the camera with a calm composed expression. The model is centered with controlled, modest negative space.",
        sizeProfile: "amazon-main",
      },
      {
        role: "three-quarter",
        label: "Three-quarter view",
        framing:
          "three-quarter body crop, model rotated approximately 30° to the model's right, head turned slightly back toward the camera, weight shifted to the back leg. Mid-thigh up.",
        sizeProfile: "amazon-lifestyle",
      },
      {
        role: "profile",
        label: "Profile / side view",
        framing:
          "left-side profile of the model from mid-thigh up, body fully turned 90° to the model's left, chin slightly raised, gaze forward (away from the camera). Reveals the side silhouette of the garment.",
        sizeProfile: "amazon-lifestyle",
      },
      {
        role: "full-body",
        label: "Full body / scale",
        framing:
          "full-body shot from head to feet, eye-level, body squared to the camera with arms relaxed at the sides, weight even, neutral expression. Provides a clear scale and fit reference for the buyer.",
        sizeProfile: "amazon-lifestyle",
      },
      {
        role: "detail-hardware",
        label: "Detail · hardware",
        framing:
          "extreme close-up of the most distinctive hardware or construction detail of the garment (buttons, zipper pull, label, pocket flap, embroidery, or stitching). The crop is tight enough that the hardware fills 60-80% of the frame; the model's hand or torso is visible in soft background. Sharp, raking light reveals texture.",
        sizeProfile: "amazon-lifestyle",
      },
      {
        role: "detail-fabric",
        label: "Detail · fabric",
        framing:
          "close-up of the fabric weave at the chest or sleeve area, showing thread-level texture and any visible patterning. Soft directional light grazes the surface to reveal weave depth. Crop is tight on the fabric; only a small portion of the model's body is visible.",
        sizeProfile: "amazon-lifestyle",
      },
    ],
  },

  shopify: {
    platform: "shopify",
    label: "Shopify lookbook",
    hint: "1 hero + 3 supporting. Square 2048 + landscape banner.",
    shots: [
      {
        role: "hero",
        label: "Hero",
        framing:
          "front-facing three-quarter body crop, model squared to camera with a subtle rotation, calm direct gaze, mid-thigh up.",
        sizeProfile: "shopify-product",
      },
      {
        role: "three-quarter",
        label: "Three-quarter",
        framing:
          "three-quarter body, model rotated 30° to their right, head turned slightly back to camera, weight on the back leg.",
        sizeProfile: "shopify-product",
      },
      {
        role: "full-body",
        label: "Full body",
        framing:
          "full-body crop from head to feet, eye-level, body squared, arms relaxed.",
        sizeProfile: "shopify-product",
      },
      {
        role: "hero",
        label: "Hero banner",
        framing:
          "wide horizontal frame with the model centered or slightly left, deliberate negative space on the right, mid-torso up, eye-level.",
        sizeProfile: "shopify-hero",
      },
    ],
  },

  instagram: {
    platform: "instagram",
    label: "Instagram carousel",
    hint: "4 frames at 1080×1350 (4:5 portrait — best engagement).",
    shots: [
      {
        role: "hero",
        label: "Frame 1 · hero",
        framing:
          "front-facing three-quarter body, model squared to camera, calm direct gaze, mid-thigh up.",
        sizeProfile: "ig-feed-portrait",
      },
      {
        role: "three-quarter",
        label: "Frame 2 · three-quarter",
        framing:
          "three-quarter body rotation to the model's right, head turned slightly back to camera, hand at hip or near hair.",
        sizeProfile: "ig-feed-portrait",
      },
      {
        role: "detail-hardware",
        label: "Frame 3 · detail",
        framing:
          "tight close-up of the most distinctive hardware or construction detail of the garment, with model's hand or torso framing the shot in soft focus.",
        sizeProfile: "ig-feed-portrait",
      },
      {
        role: "full-body",
        label: "Frame 4 · full body",
        framing:
          "full-body crop from head to feet, eye-level, body squared.",
        sizeProfile: "ig-feed-portrait",
      },
    ],
  },

  tiktok: {
    platform: "tiktok",
    label: "TikTok set",
    hint: "1 vertical hero + 2 alternates. 1080×1920 (9:16).",
    shots: [
      {
        role: "hero",
        label: "Vertical hero",
        framing:
          "vertical full-body framing from above the head to just below the knees, model squared to camera with subtle rotation, eye-level, calm direct gaze.",
        sizeProfile: "tiktok-reels",
      },
      {
        role: "three-quarter",
        label: "Three-quarter",
        framing:
          "vertical three-quarter body, rotated 30° to the model's right, head turned slightly back to camera, hand at hip.",
        sizeProfile: "tiktok-reels",
      },
      {
        role: "detail-hardware",
        label: "Detail close-up",
        framing:
          "vertical close-up framing the most distinctive hardware or construction detail of the garment, with the model's hand or torso visible in soft focus.",
        sizeProfile: "tiktok-reels",
      },
    ],
  },
};

export function listPackPlatforms(): PackSpec[] {
  return Object.values(LISTING_PACKS);
}
