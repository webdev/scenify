export type ImageModelId =
  | "gpt-image-2"
  | "nano-banana-2"
  | "flux-kontext"
  | "flux-2";

export type RegisterId =
  | "catalog-dtc"
  | "editorial-fashion"
  | "sun-drenched-lifestyle"
  | "studio-glamour";

export interface RegisterConfig {
  id: RegisterId;
  label: string;
  hint: string;
  brandTriad: string;
  poseLanguage: string;
  lighting: string;
  skinTreatment: string;
  framing: string;
  closingLine: string;
}

export const REGISTERS: RegisterConfig[] = [
  {
    id: "catalog-dtc",
    label: "Catalog DTC",
    hint: "Aritzia, Skims, Reformation — clean, neutral, calm gaze",
    brandTriad: "Aritzia, Skims, and Reformation",
    poseLanguage:
      "composed and natural — relaxed three-quarter stance, weight even, hands resting at sides, calm direct-to-camera gaze, mouth relaxed",
    lighting:
      "broad even soft front lighting from a large softbox positioned slightly above eye level, minimal directional shadow, generous fill, neutral 5500K daylight, faint ground shadow",
    skinTreatment:
      "natural unretouched skin with visible pores, faint asymmetry between the eyes, micro-creases retained, individual eyebrow hairs, a single small natural mark — no airbrushing",
    framing:
      "eye-level straight-on full-body or three-quarter-body crop, 85mm equivalent, body squared to camera with a very slight rotation",
    closingLine:
      "Match the visual quality of [BRAND_TRIAD] product pages — clean, minimal, sun-warmed studio DTC.",
  },
  {
    id: "editorial-fashion",
    label: "Editorial fashion",
    hint: "Frankies Bikinis, House of CB, Skims campaign — confident, sultry, dramatic",
    brandTriad: "Frankies Bikinis, House of CB, and Skims campaign editorials",
    poseLanguage:
      "editorial confidence — weight shifted to the back leg with a slight back arch, one hand near the hair or resting on the hip, head tilted with the chin slightly down, lips parted, deliberate sultry direct gaze, elongated silhouette and shoulder line, the model owns the frame",
    lighting:
      "dramatic single-source key light camera-left at roughly 45° with controlled soft falloff to the right side of the face shaping the cheekbone and jaw, hair-light separation behind the model, subtle rim on the shoulders, color temperature ~5000K with a faint warm key, deliberate negative space",
    skinTreatment:
      "editorial-retouch register — pore detail preserved in the highlights and shadows but smoothed and unified through the mid-tones, clean catchlights in the eyes, glossy lip with a natural sheen, slight highlight gloss on the cheekbones, collarbones, and shoulders, refined and intentional rather than airbrushed",
    framing:
      "slightly low-angle three-quarter or chest-up close crop, 85mm or 100mm at f/1.8 to f/2.0, deliberate negative space on the open side of the frame",
    closingLine:
      "Match the visual quality of [BRAND_TRIAD] — confident, glamorous, deliberate, and sensual without ever feeling like a magazine spread or a render.",
  },
  {
    id: "sun-drenched-lifestyle",
    label: "Sun-drenched lifestyle",
    hint: "Free People, Reformation, Aerie — golden hour, candid, lived-in",
    brandTriad: "Free People, Reformation, and Aerie golden-hour lifestyle",
    poseLanguage:
      "candid mid-moment — slight smile or mid-laugh, hair caught in a light breeze, one hand loosely brushing hair back, weight shifted in motion, unposed and believable",
    lighting:
      "golden-hour natural sunlight from camera-right at a low angle around 4500K, warm ambient bounce filling the shadow side, soft rim light on the hair and shoulder, subtle lens flare in the highlights, faint sun-spill across the frame",
    skinTreatment:
      "natural sun-warmed skin with retained texture, fine sun-kissed flush across the cheekbones and shoulders, individual flyaway hairs catching backlight, no heavy retouch",
    framing:
      "mid-thigh-up to full-body, 35mm or 50mm, slightly environmental — a hint of horizon, foliage, or architectural texture but not foregrounded",
    closingLine:
      "Match the visual quality of [BRAND_TRIAD] — warm, candid, lived-in, and effortlessly aspirational.",
  },
  {
    id: "studio-glamour",
    label: "Studio glamour",
    hint: "Tom Ford, Mugler, Margiela campaign — sculptural, polished, decisive",
    brandTriad: "Tom Ford, Mugler, and Maison Margiela campaign",
    poseLanguage:
      "sculptural and polished — arched neck, lifted shoulder line, controlled deliberate hand placement, intense direct gaze with slightly parted lips, weight committed to one leg, the silhouette engineered",
    lighting:
      "single hard-edged key light from camera-right with deep falloff into shadow, narrow rim from camera-left separating the model from the backdrop, dark or muted gradient backdrop, dramatic chiaroscuro shaping the cheekbones, jaw, collarbones, and figure, color temperature ~4800K",
    skinTreatment:
      "polished editorial finish — high-resolution pore detail in the lit highlights, smooth unified mid-tones, glossy lip with a deliberate highlight, sculptural shadow definition along the cheekbone, jaw, and collarbone, controlled and intentional",
    framing:
      "tight three-quarter or chest-up close, 85mm to 105mm at f/2.0, the figure dominant in the frame against a controlled backdrop",
    closingLine:
      "Match the visual quality of [BRAND_TRIAD] — sculptural, polished, decisive. The image must feel like a couture campaign captured on a real sound stage with real light.",
  },
];

export type ImageQuality = "low" | "medium" | "high" | "auto";

export type ImageSize = "1024x1024" | "1024x1536" | "1536x1024" | "auto";

export type SizeProfileId =
  | "square-1024"
  | "portrait-1024"
  | "landscape-1024"
  | "amazon-main"
  | "amazon-lifestyle"
  | "shopify-product"
  | "shopify-hero"
  | "ebay-main"
  | "tiktok-shop"
  | "tiktok-reels"
  | "tiktok-ad-square"
  | "ig-feed-square"
  | "ig-feed-portrait"
  | "ig-feed-landscape"
  | "ig-reels-stories";

export type SizeMarketplace =
  | "Generic"
  | "Amazon"
  | "Shopify"
  | "eBay"
  | "TikTok"
  | "Instagram";

export interface SizeProfile {
  id: SizeProfileId;
  label: string;
  hint: string;
  marketplace: SizeMarketplace;
  /** What we ask gpt-image-2 to render (closest native aspect). */
  nativeSize: ImageSize;
  /** Final target dimensions after post-processing. */
  target: { width: number; height: number };
}

export const SIZE_PROFILES: SizeProfile[] = [
  // Generic — render-only at native resolutions, no upscale.
  {
    id: "square-1024",
    label: "Square — 1024",
    hint: "Native gpt-image-2",
    marketplace: "Generic",
    nativeSize: "1024x1024",
    target: { width: 1024, height: 1024 },
  },
  {
    id: "portrait-1024",
    label: "Portrait — 1024×1536",
    hint: "Native gpt-image-2",
    marketplace: "Generic",
    nativeSize: "1024x1536",
    target: { width: 1024, height: 1536 },
  },
  {
    id: "landscape-1024",
    label: "Landscape — 1536×1024",
    hint: "Native gpt-image-2",
    marketplace: "Generic",
    nativeSize: "1536x1024",
    target: { width: 1536, height: 1024 },
  },

  // Amazon
  {
    id: "amazon-main",
    label: "Amazon main — 2048×2048",
    hint: "1:1 required, ≥1600 longest side enables zoom",
    marketplace: "Amazon",
    nativeSize: "1024x1024",
    target: { width: 2048, height: 2048 },
  },
  {
    id: "amazon-lifestyle",
    label: "Amazon lifestyle — 2048×2048",
    hint: "Secondary product images",
    marketplace: "Amazon",
    nativeSize: "1024x1024",
    target: { width: 2048, height: 2048 },
  },

  // Shopify
  {
    id: "shopify-product",
    label: "Shopify product — 2048×2048",
    hint: "Recommended product image",
    marketplace: "Shopify",
    nativeSize: "1024x1024",
    target: { width: 2048, height: 2048 },
  },
  {
    id: "shopify-hero",
    label: "Shopify hero — 1920×1080",
    hint: "Collection / homepage banner",
    marketplace: "Shopify",
    nativeSize: "1536x1024",
    target: { width: 1920, height: 1080 },
  },

  // eBay
  {
    id: "ebay-main",
    label: "eBay main — 1600×1600",
    hint: "1:1, ≥1600 enables zoom + Enhanced",
    marketplace: "eBay",
    nativeSize: "1024x1024",
    target: { width: 1600, height: 1600 },
  },

  // TikTok
  {
    id: "tiktok-shop",
    label: "TikTok Shop — 1080×1080",
    hint: "Product image, 1:1",
    marketplace: "TikTok",
    nativeSize: "1024x1024",
    target: { width: 1080, height: 1080 },
  },
  {
    id: "tiktok-reels",
    label: "TikTok Reels — 1080×1920",
    hint: "9:16 full-screen feed / ads",
    marketplace: "TikTok",
    nativeSize: "1024x1536",
    target: { width: 1080, height: 1920 },
  },
  {
    id: "tiktok-ad-square",
    label: "TikTok Ad — 1200×1200",
    hint: "1:1 ad creative",
    marketplace: "TikTok",
    nativeSize: "1024x1024",
    target: { width: 1200, height: 1200 },
  },

  // Instagram
  {
    id: "ig-feed-square",
    label: "IG feed — 1080×1080",
    hint: "1:1 feed post / Shop product",
    marketplace: "Instagram",
    nativeSize: "1024x1024",
    target: { width: 1080, height: 1080 },
  },
  {
    id: "ig-feed-portrait",
    label: "IG feed portrait — 1080×1350",
    hint: "4:5 — tallest in feed, best engagement",
    marketplace: "Instagram",
    nativeSize: "1024x1536",
    target: { width: 1080, height: 1350 },
  },
  {
    id: "ig-feed-landscape",
    label: "IG feed landscape — 1080×566",
    hint: "1.91:1",
    marketplace: "Instagram",
    nativeSize: "1536x1024",
    target: { width: 1080, height: 566 },
  },
  {
    id: "ig-reels-stories",
    label: "IG Reels / Stories — 1080×1920",
    hint: "9:16 full-screen vertical",
    marketplace: "Instagram",
    nativeSize: "1024x1536",
    target: { width: 1080, height: 1920 },
  },
];

export interface Source {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
  width?: number;
  height?: number;
  createdAt: string;
}

export type GenerationStatus = "pending" | "running" | "succeeded" | "failed";

export interface Generation {
  id: string;
  sourceId: string;
  presetId: string;
  model: ImageModelId;
  /** What the user originally selected; if it differs from `model`, the request was auto-routed or fell back. */
  requestedModel?: ImageModelId;
  size: ImageSize;
  quality: ImageQuality;
  sizeProfile?: SizeProfileId;
  /** Seed passed to the image model. Honored by nano-banana and flux-kontext; gpt-image-2 currently ignores it. */
  seed?: number;
  /** Visual register the constructed prompt was written in (catalog, editorial, etc.). */
  register?: RegisterId;
  status: GenerationStatus;
  constructedPrompt?: string;
  outputUrl?: string;
  error?: string;
  /** Fal endpoint that ultimately rendered the image (after any auto-routing or fallback). */
  falEndpoint?: string;
  /** Fal request id — cross-references the request in fal's dashboard. */
  falRequestId?: string;
  /** Exact input payload sent to fal. */
  falInput?: Record<string, unknown>;
  /** Raw response data from fal (image url, timings, seed echo, nsfw flags, etc.). */
  falResponse?: unknown;
  /** Listing pack grouping. NULL means standalone shot. */
  packId?: string;
  packPlatform?: string;
  packRole?: string;
  packShotIndex?: number;
  shotFraming?: string;
  /** Set when this generation is a "complete-look" follow-up to another. */
  parentGenerationId?: string;
  /** Color verification (Phase 1+2). HEX swatches extracted from source/output. */
  sourceColors?: ColorSwatchSerialized[];
  outputColors?: ColorSwatchSerialized[];
  colorMaxDeltaE?: number;
  colorAvgDeltaE?: number;
  /** Focal-point metadata for downstream aspect-ratio cropping. Always
   * populated on success — falls back to image center when detection is
   * low-confidence. Coords are 0..1 normalized against the persisted output. */
  focalPoint?: FocalPoint;
  /** Dominant subject's face bbox (0..1 normalized). Present iff a face was
   * detected with high confidence. */
  faceBox?: FaceBox | null;
  createdAt: string;
  completedAt?: string;
}

export type FocalPointSource = "face" | "saliency" | "center";

export interface FocalPoint {
  x: number;
  y: number;
  confidence: number;
  source: FocalPointSource;
}

export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}

export interface ColorSwatchSerialized {
  hex: string;
  rgb: [number, number, number];
  population: number;
  label: string;
}

export interface PresetReferenceImage {
  id: string;
  url: string;
  width: number;
  height: number;
  filename: string;
  favorited: boolean;
}

export interface Preset {
  /** Public id used by API consumers — currently the slug. */
  id: string;
  /** DB row id (nanoid) — needed to call admin endpoints scoped by preset. */
  dbId: string;
  name: string;
  description: string;
  mood: string;
  category: string;
  palette: string[];
  displayOrder: number;
  heroImageUrl: string | null;
  isPro: boolean;
  /** URL-only list (back-compat for callers that only need URLs). */
  referenceImageUrls: string[];
  /** Full reference info — needed for justified-rows masonry + admin actions. */
  referenceImages: PresetReferenceImage[];
}

/** Customer-card subset returned by /api/public/presets — no reference images. */
export interface PublicPreset {
  slug: string;
  name: string;
  description: string;
  mood: string;
  category: string;
  palette: string[];
  displayOrder: number;
  heroImageUrl: string | null;
}

export interface DB {
  sources: Source[];
  generations: Generation[];
  presets: Preset[];
}
