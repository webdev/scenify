import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  integer,
  timestamp,
  jsonb,
  real,
  boolean,
} from "drizzle-orm/pg-core";

export const preset = pgTable("preset", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  // Customer-facing presentation metadata — surfaced to anonymous /try
  // pages via /api/public/presets. Reference images stay private.
  mood: text("mood").notNull().default(""),
  category: text("category").notNull().default(""),
  palette: text("palette").array().notNull().default(sql`'{}'::text[]`),
  displayOrder: integer("display_order").notNull().default(0),
  heroImageUrl: text("hero_image_url"),
  isPro: boolean("is_pro").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`NOW()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`NOW()`),
});

export const presetImage = pgTable("preset_image", {
  id: text("id").primaryKey(),
  presetId: text("preset_id")
    .notNull()
    .references(() => preset.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  blobPathname: text("blob_pathname"),
  filename: text("filename"),
  sortKey: text("sort_key").notNull().default(""),
  cachedPrompt: text("cached_prompt"),
  bytes: integer("bytes"),
  width: integer("width"),
  height: integer("height"),
  favorited: boolean("favorited").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`NOW()`),
});

export type PresetRow = typeof preset.$inferSelect;
export type PresetImageRow = typeof presetImage.$inferSelect;

// Test products — pool of source product photos for batch testing.
// Mirrors the local `test-sources/` directory but lives in Postgres + Blob
// so it works on serverless.
export const testProduct = pgTable("test_product", {
  id: text("id").primaryKey(),
  url: text("url").notNull(),
  blobPathname: text("blob_pathname"),
  filename: text("filename").notNull(),
  collection: text("collection").notNull().default(""),
  sortKey: text("sort_key").notNull().default(""),
  bytes: integer("bytes"),
  width: integer("width"),
  height: integer("height"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`NOW()`),
});

export type TestProductRow = typeof testProduct.$inferSelect;

// Uploaded / imported source product photos.
export const source = pgTable("source", {
  id: text("id").primaryKey(),
  url: text("url").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  width: integer("width"),
  height: integer("height"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`NOW()`),
});

export type SourceRow = typeof source.$inferSelect;

// Generation runs — one row per fal.ai render request.
export const generation = pgTable("generation", {
  id: text("id").primaryKey(),
  sourceId: text("source_id")
    .notNull()
    .references(() => source.id, { onDelete: "cascade" }),
  presetId: text("preset_id"),
  model: text("model").notNull(),
  requestedModel: text("requested_model"),
  size: text("size").notNull(),
  quality: text("quality").notNull(),
  sizeProfile: text("size_profile"),
  seed: integer("seed"),
  register: text("register"),
  status: text("status").notNull(),
  constructedPrompt: text("constructed_prompt"),
  outputUrl: text("output_url"),
  error: text("error"),
  falEndpoint: text("fal_endpoint"),
  falRequestId: text("fal_request_id"),
  falInput: jsonb("fal_input"),
  falResponse: jsonb("fal_response"),
  // Listing-pack columns: when a generation is part of a multi-shot pack,
  // these group it. NULL means the generation is a standalone shot.
  packId: text("pack_id"),
  packPlatform: text("pack_platform"),
  packRole: text("pack_role"),
  packShotIndex: integer("pack_shot_index"),
  shotFraming: text("shot_framing"),
  // Complete-look follow-ups: when a generation is a continuation of another
  // (same model + garment, different pose), this points at the parent.
  parentGenerationId: text("parent_generation_id"),
  // Color fidelity tracking (phase 1: pre-flight; phase 2: post-flight verification)
  sourceColors: jsonb("source_colors"),
  outputColors: jsonb("output_colors"),
  colorMaxDeltaE: real("color_max_delta_e"),
  colorAvgDeltaE: real("color_avg_delta_e"),
  // Focal-point metadata for downstream aspect-ratio cropping. Always written
  // on success (center fallback when detection is low-confidence). Coords are
  // 0..1 normalized against the persisted output image's natural size.
  focalPointX: real("focal_point_x"),
  focalPointY: real("focal_point_y"),
  focalPointConfidence: real("focal_point_confidence"),
  focalPointSource: text("focal_point_source"),
  faceBox: jsonb("face_box"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`NOW()`),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export type GenerationRow = typeof generation.$inferSelect;
