import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { put } from "@vercel/blob";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { eq, and } from "drizzle-orm";
import { getDb, schema } from "../src/lib/db/client";

const ROOT = process.cwd();
const PRESETS_DIR = path.join(ROOT, "public", "presets");
const PROMPT_CACHE_DIR = path.join(ROOT, "data", "preset-prompts");
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

interface PresetSeed {
  slug: string;
  name: string;
  description: string;
}

const PRESET_SEEDS: PresetSeed[] = [
  {
    slug: "studio-direct",
    name: "Studio Lifestyle — Direct Gaze",
    description:
      "Clean studio lifestyle with a calm, confident, direct-gaze model on a seamless backdrop. Champion / Carhartt WIP register.",
  },
];

async function walk(
  rootDir: string,
  relParts: string[] = [],
): Promise<string[]> {
  const fullDir = path.join(rootDir, ...relParts);
  let entries: import("node:fs").Dirent[] = [];
  try {
    entries = (await fs.readdir(fullDir, {
      withFileTypes: true,
    })) as unknown as import("node:fs").Dirent[];
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    if (e.isDirectory()) {
      out.push(...(await walk(rootDir, [...relParts, e.name])));
    } else if (
      e.isFile() &&
      IMAGE_EXTS.has(path.extname(e.name).toLowerCase())
    ) {
      out.push([...relParts, e.name].join("/"));
    }
  }
  return out;
}

function legacyCacheKey(localUrl: string): string {
  return crypto.createHash("sha1").update(localUrl).digest("hex");
}

async function readLegacyCachedPrompt(
  legacyLocalUrl: string,
): Promise<string | null> {
  const file = path.join(PROMPT_CACHE_DIR, `${legacyCacheKey(legacyLocalUrl)}.txt`);
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
}

async function migrate() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("BLOB_READ_WRITE_TOKEN missing. Source .env.local first.");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL missing. Provision Neon and add to .env.local.");
    process.exit(1);
  }

  const db = getDb();

  for (const seed of PRESET_SEEDS) {
    const presetRoot = path.join(PRESETS_DIR, seed.slug);
    const stat = await fs.stat(presetRoot).catch(() => null);
    if (!stat?.isDirectory()) {
      console.warn(`No images directory for preset "${seed.slug}", skipping.`);
      continue;
    }

    const existing = await db
      .select()
      .from(schema.preset)
      .where(eq(schema.preset.slug, seed.slug));

    let presetId: string;
    if (existing.length > 0) {
      presetId = existing[0].id;
      console.log(`Preset "${seed.slug}" exists (id=${presetId}), updating images.`);
    } else {
      presetId = nanoid(12);
      await db.insert(schema.preset).values({
        id: presetId,
        slug: seed.slug,
        name: seed.name,
        description: seed.description,
      });
      console.log(`Created preset "${seed.slug}" (id=${presetId}).`);
    }

    const relPaths = await walk(presetRoot);
    console.log(`  ${relPaths.length} image files found in ${presetRoot}`);

    for (const rel of relPaths) {
      const fsPath = path.join(presetRoot, rel);
      const legacyLocalUrl = `/presets/${seed.slug}/${rel}`;

      const already = await db
        .select()
        .from(schema.presetImage)
        .where(
          and(
            eq(schema.presetImage.presetId, presetId),
            eq(schema.presetImage.sortKey, rel),
          ),
        );
      if (already.length > 0) {
        process.stdout.write(".");
        continue;
      }

      const buffer = await fs.readFile(fsPath);
      const ext = path.extname(rel).toLowerCase();
      const contentType =
        ext === ".png"
          ? "image/png"
          : ext === ".webp"
            ? "image/webp"
            : "image/jpeg";

      let width: number | undefined;
      let height: number | undefined;
      try {
        const meta = await sharp(buffer).metadata();
        width = meta.width;
        height = meta.height;
      } catch {
        /* ignore */
      }

      const blobKey = `presets/${seed.slug}/${rel}`;
      const blob = await put(blobKey, buffer, {
        access: "public",
        contentType,
        addRandomSuffix: false,
        allowOverwrite: true,
      });

      const cachedPrompt = await readLegacyCachedPrompt(legacyLocalUrl);

      await db.insert(schema.presetImage).values({
        id: nanoid(12),
        presetId,
        url: blob.url,
        blobPathname: blobKey,
        filename: path.basename(rel),
        sortKey: rel,
        cachedPrompt: cachedPrompt ?? null,
        bytes: buffer.byteLength,
        width,
        height,
      });
      process.stdout.write("+");
    }
    console.log("");
    console.log(`  preset "${seed.slug}" done.`);
  }
  console.log("Migration complete.");
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
