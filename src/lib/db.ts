import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "./db/client";
import type {
  FocalPointSource,
  Generation,
  GenerationStatus,
  ImageModelId,
  ImageQuality,
  ImageSize,
  RegisterId,
  SizeProfileId,
  Source,
} from "./types";

function rowToSource(row: typeof schema.source.$inferSelect): Source {
  return {
    id: row.id,
    url: row.url,
    filename: row.filename,
    mimeType: row.mimeType,
    createdAt: row.createdAt.toISOString(),
  };
}

function rowToGeneration(
  row: typeof schema.generation.$inferSelect,
): Generation {
  return {
    id: row.id,
    sourceId: row.sourceId,
    presetId: row.presetId ?? "",
    model: row.model as ImageModelId,
    requestedModel: (row.requestedModel as ImageModelId | null) ?? undefined,
    size: row.size as ImageSize,
    quality: row.quality as ImageQuality,
    sizeProfile: (row.sizeProfile as SizeProfileId | null) ?? undefined,
    seed: row.seed ?? undefined,
    register: (row.register as RegisterId | null) ?? undefined,
    status: row.status as GenerationStatus,
    constructedPrompt: row.constructedPrompt ?? undefined,
    outputUrl: row.outputUrl ?? undefined,
    error: row.error ?? undefined,
    falEndpoint: row.falEndpoint ?? undefined,
    falRequestId: row.falRequestId ?? undefined,
    falInput: (row.falInput as Record<string, unknown> | null) ?? undefined,
    falResponse: row.falResponse ?? undefined,
    packId: row.packId ?? undefined,
    packPlatform: row.packPlatform ?? undefined,
    packRole: row.packRole ?? undefined,
    packShotIndex: row.packShotIndex ?? undefined,
    shotFraming: row.shotFraming ?? undefined,
    parentGenerationId: row.parentGenerationId ?? undefined,
    sourceColors:
      (row.sourceColors as Generation["sourceColors"]) ?? undefined,
    outputColors:
      (row.outputColors as Generation["outputColors"]) ?? undefined,
    colorMaxDeltaE: row.colorMaxDeltaE ?? undefined,
    colorAvgDeltaE: row.colorAvgDeltaE ?? undefined,
    focalPoint:
      row.focalPointX != null &&
      row.focalPointY != null &&
      row.focalPointConfidence != null &&
      row.focalPointSource != null
        ? {
            x: row.focalPointX,
            y: row.focalPointY,
            confidence: row.focalPointConfidence,
            source: row.focalPointSource as FocalPointSource,
          }
        : undefined,
    faceBox: (row.faceBox as Generation["faceBox"]) ?? undefined,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : undefined,
  };
}

export async function listSources(): Promise<Source[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.source)
    .orderBy(desc(schema.source.createdAt));
  return rows.map(rowToSource);
}

export async function getSource(id: string): Promise<Source | undefined> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.source)
    .where(eq(schema.source.id, id));
  return rows[0] ? rowToSource(rows[0]) : undefined;
}

export async function addSource(s: Source): Promise<Source> {
  const db = getDb();
  await db.insert(schema.source).values({
    id: s.id,
    url: s.url,
    filename: s.filename,
    mimeType: s.mimeType,
  });
  return s;
}

export async function listGenerations(
  sourceId?: string,
): Promise<Generation[]> {
  const db = getDb();
  const query = db
    .select()
    .from(schema.generation)
    .orderBy(desc(schema.generation.createdAt));
  const rows = sourceId
    ? await db
        .select()
        .from(schema.generation)
        .where(eq(schema.generation.sourceId, sourceId))
        .orderBy(desc(schema.generation.createdAt))
    : await query;
  return rows.map(rowToGeneration);
}

export async function listGenerationsByPackId(
  packId: string,
): Promise<Generation[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.generation)
    .where(eq(schema.generation.packId, packId))
    .orderBy(desc(schema.generation.createdAt));
  return rows.map(rowToGeneration);
}

export async function getGeneration(id: string): Promise<Generation | undefined> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.generation)
    .where(eq(schema.generation.id, id));
  return rows[0] ? rowToGeneration(rows[0]) : undefined;
}

export async function addGeneration(g: Generation): Promise<Generation> {
  const db = getDb();
  await db.insert(schema.generation).values({
    id: g.id,
    sourceId: g.sourceId,
    presetId: g.presetId,
    model: g.model,
    requestedModel: g.requestedModel,
    size: g.size,
    quality: g.quality,
    sizeProfile: g.sizeProfile,
    seed: g.seed,
    register: g.register,
    status: g.status,
    constructedPrompt: g.constructedPrompt,
    outputUrl: g.outputUrl,
    error: g.error,
    falEndpoint: g.falEndpoint,
    falRequestId: g.falRequestId,
    falInput: g.falInput,
    falResponse: g.falResponse,
    packId: g.packId,
    packPlatform: g.packPlatform,
    packRole: g.packRole,
    packShotIndex: g.packShotIndex,
    shotFraming: g.shotFraming,
    parentGenerationId: g.parentGenerationId,
    sourceColors: g.sourceColors,
    outputColors: g.outputColors,
    colorMaxDeltaE: g.colorMaxDeltaE,
    colorAvgDeltaE: g.colorAvgDeltaE,
    focalPointX: g.focalPoint?.x,
    focalPointY: g.focalPoint?.y,
    focalPointConfidence: g.focalPoint?.confidence,
    focalPointSource: g.focalPoint?.source,
    faceBox: g.faceBox ?? undefined,
    completedAt: g.completedAt ? new Date(g.completedAt) : undefined,
  });
  return g;
}

export async function updateGeneration(
  id: string,
  patch: Partial<Generation>,
): Promise<Generation | undefined> {
  const db = getDb();
  const dbPatch: Partial<typeof schema.generation.$inferInsert> = {
    sourceId: patch.sourceId,
    presetId: patch.presetId,
    model: patch.model,
    requestedModel: patch.requestedModel,
    size: patch.size,
    quality: patch.quality,
    sizeProfile: patch.sizeProfile,
    seed: patch.seed,
    register: patch.register,
    status: patch.status,
    constructedPrompt: patch.constructedPrompt,
    outputUrl: patch.outputUrl,
    error: patch.error,
    falEndpoint: patch.falEndpoint,
    falRequestId: patch.falRequestId,
    falInput: patch.falInput,
    falResponse: patch.falResponse,
    packId: patch.packId,
    packPlatform: patch.packPlatform,
    packRole: patch.packRole,
    packShotIndex: patch.packShotIndex,
    shotFraming: patch.shotFraming,
    parentGenerationId: patch.parentGenerationId,
    sourceColors: patch.sourceColors,
    outputColors: patch.outputColors,
    colorMaxDeltaE: patch.colorMaxDeltaE,
    colorAvgDeltaE: patch.colorAvgDeltaE,
    focalPointX: patch.focalPoint?.x,
    focalPointY: patch.focalPoint?.y,
    focalPointConfidence: patch.focalPoint?.confidence,
    focalPointSource: patch.focalPoint?.source,
    faceBox:
      patch.faceBox === undefined
        ? undefined
        : (patch.faceBox as unknown as Record<string, unknown> | null),
    completedAt: patch.completedAt ? new Date(patch.completedAt) : undefined,
  };
  // Strip undefined keys so we don't overwrite columns with NULL.
  const filtered: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(dbPatch)) {
    if (v !== undefined) filtered[k] = v;
  }
  if (Object.keys(filtered).length === 0) {
    return getGeneration(id);
  }
  await db
    .update(schema.generation)
    .set(filtered as Partial<typeof schema.generation.$inferInsert>)
    .where(eq(schema.generation.id, id));
  return getGeneration(id);
}

export async function deleteGeneration(id: string): Promise<Generation | undefined> {
  const db = getDb();
  const existing = await getGeneration(id);
  if (!existing) return undefined;
  await db.delete(schema.generation).where(eq(schema.generation.id, id));
  return existing;
}

export { loadPreset as getPreset, loadPresets as listPresets } from "./presets";
