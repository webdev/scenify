import { eq, asc } from "drizzle-orm";
import { getDb, schema } from "./db/client";
import type { Preset } from "./types";

export async function loadPresets(): Promise<Preset[]> {
  const db = getDb();
  const presets = await db.select().from(schema.preset);
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
