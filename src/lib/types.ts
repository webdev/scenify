export type ImageModelId = "gpt-image-2" | "nano-banana-2" | "flux-kontext";

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
  status: GenerationStatus;
  constructedPrompt?: string;
  outputUrl?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

export interface Preset {
  id: string;
  name: string;
  description: string;
  referenceImageUrls: string[];
}

export interface DB {
  sources: Source[];
  generations: Generation[];
  presets: Preset[];
}
