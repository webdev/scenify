import { promises as fs } from "node:fs";
import path from "node:path";
import { put } from "@vercel/blob";
import { nanoid } from "nanoid";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

export interface StoredFile {
  url: string;
  filename: string;
  bytes: number;
  mimeType: string;
}

function extFromMime(mime: string): string {
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg" || mime === "image/jpg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/gif") return ".gif";
  return ".bin";
}

export async function saveBufferAsImage(
  buffer: Buffer,
  mimeType: string,
  prefix: string,
): Promise<StoredFile> {
  const filename = `${prefix}_${nanoid(10)}${extFromMime(mimeType)}`;

  if (useBlob) {
    const blob = await put(`sceneify/${filename}`, buffer, {
      access: "public",
      contentType: mimeType,
      addRandomSuffix: false,
    });
    return {
      url: blob.url,
      filename,
      bytes: buffer.byteLength,
      mimeType,
    };
  }

  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const fullPath = path.join(UPLOAD_DIR, filename);
  await fs.writeFile(fullPath, buffer);
  return {
    url: `/uploads/${filename}`,
    filename,
    bytes: buffer.byteLength,
    mimeType,
  };
}

export async function fetchToBuffer(
  url: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status}`);
  const mimeType = res.headers.get("content-type") ?? "image/png";
  const ab = await res.arrayBuffer();
  return { buffer: Buffer.from(ab), mimeType };
}

export function publicUrl(req: Request, relativeOrAbsolute: string): string {
  if (
    relativeOrAbsolute.startsWith("http://") ||
    relativeOrAbsolute.startsWith("https://")
  ) {
    return relativeOrAbsolute;
  }
  const baseOverride = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "");
  if (baseOverride) return `${baseOverride}${relativeOrAbsolute}`;
  const origin = new URL(req.url).origin;
  return `${origin}${relativeOrAbsolute}`;
}
