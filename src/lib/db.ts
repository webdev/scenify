import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "./db/client";
import type {
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
    sourceColors:
      (row.sourceColors as Generation["sourceColors"]) ?? undefined,
    outputColors:
      (row.outputColors as Generation["outputColors"]) ?? undefined,
    colorMaxDeltaE: row.colorMaxDeltaE ?? undefined,
    colorAvgDeltaE: row.colorAvgDeltaE ?? undefined,
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
    sourceColors: g.sourceColors,
    outputColors: g.outputColors,
    colorMaxDeltaE: g.colorMaxDeltaE,
    colorAvgDeltaE: g.colorAvgDeltaE,
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
    sourceColors: patch.sourceColors,
    outputColors: patch.outputColors,
    colorMaxDeltaE: patch.colorMaxDeltaE,
    colorAvgDeltaE: patch.colorAvgDeltaE,
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

export { loadPreset as getPreset, loadPresets as listPresets } from "./presets";
