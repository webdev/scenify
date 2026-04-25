import { promises as fs } from "node:fs";
import path from "node:path";
import type { Preset } from "./types";

const PRESETS_DIR = path.join(process.cwd(), "public", "presets");

interface PresetMeta {
  id: string;
  name: string;
  description: string;
}

const PRESET_META: PresetMeta[] = [
  {
    id: "studio-direct",
    name: "Studio Lifestyle — Direct Gaze",
    description:
      "Clean studio lifestyle with a calm, confident, direct-gaze model on a seamless backdrop. Champion / Carhartt WIP register.",
  },
];

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

async function discoverImages(presetId: string): Promise<string[]> {
  const dir = path.join(PRESETS_DIR, presetId);
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter(
        (e) =>
          e.isFile() &&
          IMAGE_EXTS.has(path.extname(e.name).toLowerCase()) &&
          !e.name.startsWith("."),
      )
      .map((e) => `/presets/${presetId}/${e.name}`)
      .sort();
  } catch {
    return [];
  }
}

export async function loadPresets(): Promise<Preset[]> {
  return Promise.all(
    PRESET_META.map(async (meta) => ({
      ...meta,
      referenceImageUrls: await discoverImages(meta.id),
    })),
  );
}

export async function loadPreset(id: string): Promise<Preset | undefined> {
  const meta = PRESET_META.find((m) => m.id === id);
  if (!meta) return undefined;
  return { ...meta, referenceImageUrls: await discoverImages(meta.id) };
}
