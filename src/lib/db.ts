import { promises as fs } from "node:fs";
import path from "node:path";
import type { Generation, Source } from "./types";

interface DBState {
  sources: Source[];
  generations: Generation[];
}

const DB_PATH = path.join(process.cwd(), "data", "db.json");

let cache: DBState | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function readFromDisk(): Promise<DBState> {
  try {
    const raw = await fs.readFile(DB_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<DBState>;
    return {
      sources: parsed.sources ?? [],
      generations: parsed.generations ?? [],
    };
  } catch {
    return { sources: [], generations: [] };
  }
}

async function load(): Promise<DBState> {
  if (cache) return cache;
  cache = await readFromDisk();
  return cache;
}

async function flush(): Promise<void> {
  if (!cache) return;
  const snapshot = JSON.stringify(cache, null, 2);
  await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
  await fs.writeFile(DB_PATH, snapshot, "utf8");
}

function enqueueWrite(): Promise<void> {
  writeQueue = writeQueue.then(flush, flush);
  return writeQueue;
}

export async function listSources(): Promise<Source[]> {
  const db = await load();
  return [...db.sources].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getSource(id: string): Promise<Source | undefined> {
  const db = await load();
  return db.sources.find((s) => s.id === id);
}

export async function addSource(s: Source): Promise<Source> {
  const db = await load();
  db.sources.unshift(s);
  await enqueueWrite();
  return s;
}

export async function listGenerations(sourceId?: string): Promise<Generation[]> {
  const db = await load();
  const all = sourceId
    ? db.generations.filter((g) => g.sourceId === sourceId)
    : db.generations;
  return [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getGeneration(id: string): Promise<Generation | undefined> {
  const db = await load();
  return db.generations.find((g) => g.id === id);
}

export async function addGeneration(g: Generation): Promise<Generation> {
  const db = await load();
  db.generations.unshift(g);
  await enqueueWrite();
  return g;
}

export async function updateGeneration(
  id: string,
  patch: Partial<Generation>,
): Promise<Generation | undefined> {
  const db = await load();
  const idx = db.generations.findIndex((g) => g.id === id);
  if (idx < 0) return undefined;
  db.generations[idx] = { ...db.generations[idx], ...patch };
  await enqueueWrite();
  return db.generations[idx];
}

export { loadPreset as getPreset, loadPresets as listPresets } from "./presets";
