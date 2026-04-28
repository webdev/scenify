import { eq, asc } from "drizzle-orm";
import { getDb, schema } from "./db/client";
import type { Preset, PublicPreset } from "./types";

export async function loadPresets(): Promise<Preset[]> {
  const db = getDb();
  const presets = await db
    .select()
    .from(schema.preset)
    .orderBy(asc(schema.preset.displayOrder), asc(schema.preset.slug));
  return Promise.all(
    presets.map(async (p) => {
      const images = await db
        .select({
          id: schema.presetImage.id,
          url: schema.presetImage.url,
          width: schema.presetImage.width,
          height: schema.presetImage.height,
          filename: schema.presetImage.filename,
          favorited: schema.presetImage.favorited,
        })
        .from(schema.presetImage)
        .where(eq(schema.presetImage.presetId, p.id))
        .orderBy(asc(schema.presetImage.sortKey));
      return {
        id: p.slug,
        dbId: p.id,
        name: p.name,
        description: p.description,
        mood: p.mood,
        category: p.category,
        palette: p.palette,
        displayOrder: p.displayOrder,
        heroImageUrl: p.heroImageUrl,
        referenceImageUrls: images.map((r) => r.url),
        referenceImages: images.map((r) => ({
          id: r.id,
          url: r.url,
          width: r.width ?? 1024,
          height: r.height ?? 1024,
          filename: r.filename ?? "",
          favorited: r.favorited ?? false,
        })),
      };
    }),
  );
}

export async function loadPreset(slug: string): Promise<Preset | undefined> {
  const db = getDb();
  const presetRow = await db
    .select()
    .from(schema.preset)
    .where(eq(schema.preset.slug, slug));
  if (presetRow.length === 0) return undefined;
  const p = presetRow[0];
  const images = await db
    .select({
      id: schema.presetImage.id,
      url: schema.presetImage.url,
      width: schema.presetImage.width,
      height: schema.presetImage.height,
      filename: schema.presetImage.filename,
      favorited: schema.presetImage.favorited,
    })
    .from(schema.presetImage)
    .where(eq(schema.presetImage.presetId, p.id))
    .orderBy(asc(schema.presetImage.sortKey));
  return {
    id: p.slug,
    dbId: p.id,
    name: p.name,
    description: p.description,
    mood: p.mood,
    category: p.category,
    palette: p.palette,
    displayOrder: p.displayOrder,
    heroImageUrl: p.heroImageUrl,
    referenceImageUrls: images.map((r) => r.url),
    referenceImages: images.map((r) => ({
      id: r.id,
      url: r.url,
      width: r.width ?? 1024,
      height: r.height ?? 1024,
      filename: r.filename ?? "",
      favorited: r.favorited ?? false,
    })),
  };
}

/**
 * Customer-card view: presentation metadata only, ordered for display.
 * heroImageUrl falls back to the first preset_image when null.
 */
export async function loadPublicPresets(): Promise<PublicPreset[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.preset.id,
      slug: schema.preset.slug,
      name: schema.preset.name,
      description: schema.preset.description,
      mood: schema.preset.mood,
      category: schema.preset.category,
      palette: schema.preset.palette,
      displayOrder: schema.preset.displayOrder,
      heroImageUrl: schema.preset.heroImageUrl,
    })
    .from(schema.preset)
    .orderBy(asc(schema.preset.displayOrder), asc(schema.preset.slug));

  const out: PublicPreset[] = [];
  for (const r of rows) {
    let heroImageUrl = r.heroImageUrl;
    if (!heroImageUrl) {
      const first = await db
        .select({ url: schema.presetImage.url })
        .from(schema.presetImage)
        .where(eq(schema.presetImage.presetId, r.id))
        .orderBy(asc(schema.presetImage.sortKey))
        .limit(1);
      heroImageUrl = first[0]?.url ?? null;
    }
    out.push({
      slug: r.slug,
      name: r.name,
      description: r.description,
      mood: r.mood,
      category: r.category,
      palette: r.palette,
      displayOrder: r.displayOrder,
      heroImageUrl,
    });
  }
  return out;
}
