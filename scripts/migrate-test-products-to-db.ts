import { promises as fs } from "node:fs";
import path from "node:path";
import { put } from "@vercel/blob";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { eq, and } from "drizzle-orm";
import { getDb, schema } from "../src/lib/db/client";

const ROOT = process.cwd();
const TEST_DIR = path.join(ROOT, "test-sources");
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

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

async function migrate() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("BLOB_READ_WRITE_TOKEN missing.");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL missing.");
    process.exit(1);
  }

  const db = getDb();
  const stat = await fs.stat(TEST_DIR).catch(() => null);
  if (!stat?.isDirectory()) {
    console.warn(`No ${TEST_DIR} directory; nothing to migrate.`);
    return;
  }

  const relPaths = await walk(TEST_DIR);
  console.log(`Found ${relPaths.length} test product files in ${TEST_DIR}`);

  for (const rel of relPaths) {
    const fsPath = path.join(TEST_DIR, rel);
    const filename = path.basename(rel);
    const collection = path.dirname(rel) === "." ? "" : path.dirname(rel);
    const sortKey = rel;

    const already = await db
      .select()
      .from(schema.testProduct)
      .where(
        and(
          eq(schema.testProduct.sortKey, sortKey),
          eq(schema.testProduct.collection, collection),
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

    const blobKey = `test-products/${rel}`;
    const blob = await put(blobKey, buffer, {
      access: "public",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    await db.insert(schema.testProduct).values({
      id: nanoid(12),
      url: blob.url,
      blobPathname: blobKey,
      filename,
      collection,
      sortKey,
      bytes: buffer.byteLength,
      width,
      height,
    });
    process.stdout.write("+");
  }
  console.log("");
  console.log("Test product migration complete.");
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
