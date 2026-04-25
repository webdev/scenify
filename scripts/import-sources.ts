import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DEFAULT_DIR = path.join(ROOT, "test-sources");
const API_BASE = process.env.SCENEIFY_API_BASE ?? "http://localhost:3000";
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

function mimeFromExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

async function main() {
  const dirArg = process.argv[2];
  const dir = dirArg ? path.resolve(ROOT, dirArg) : DEFAULT_DIR;

  const stat = await fs.stat(dir).catch(() => null);
  if (!stat?.isDirectory()) {
    console.error(`Not a directory: ${dir}`);
    process.exit(1);
  }

  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = entries
    .filter(
      (e) =>
        e.isFile() &&
        IMAGE_EXTS.has(path.extname(e.name).toLowerCase()) &&
        !e.name.startsWith("."),
    )
    .map((e) => path.join(dir, e.name))
    .sort();

  if (files.length === 0) {
    console.error(`No images in ${dir}`);
    process.exit(1);
  }

  console.log(`Importing ${files.length} images from ${dir} → ${API_BASE}/api/sources`);

  let success = 0;
  let failed = 0;
  for (const file of files) {
    const buffer = await fs.readFile(file);
    const filename = path.basename(file);
    const mime = mimeFromExt(path.extname(file));
    const blob = new Blob([new Uint8Array(buffer)], { type: mime });
    const fd = new FormData();
    fd.set("file", blob, filename);

    const res = await fetch(`${API_BASE}/api/sources`, {
      method: "POST",
      body: fd,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`✗ ${filename}: ${res.status} ${text}`);
      failed++;
      continue;
    }
    const json = (await res.json()) as { source: { id: string; url: string } };
    console.log(`✓ ${filename} → ${json.source.id}`);
    success++;
  }

  console.log(`\nDone: ${success} succeeded, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
