import { promises as fs } from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "test-sources");
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

export async function listTestProductFilenames(): Promise<string[]> {
  try {
    const entries = await fs.readdir(DIR, { withFileTypes: true });
    return entries
      .filter(
        (e) =>
          e.isFile() &&
          IMAGE_EXTS.has(path.extname(e.name).toLowerCase()) &&
          !e.name.startsWith("."),
      )
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

export async function readTestProduct(filename: string): Promise<{
  buffer: Buffer;
  mimeType: string;
}> {
  if (filename.includes("/") || filename.includes("..") || filename.startsWith(".")) {
    throw new Error("invalid filename");
  }
  const fsPath = path.join(DIR, filename);
  const buffer = await fs.readFile(fsPath);
  const ext = path.extname(filename).toLowerCase();
  const mimeType =
    ext === ".png"
      ? "image/png"
      : ext === ".webp"
        ? "image/webp"
        : ext === ".gif"
          ? "image/gif"
          : "image/jpeg";
  return { buffer, mimeType };
}
