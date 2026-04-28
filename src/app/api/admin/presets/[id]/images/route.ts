import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { auth, isAdminEmail } from "@/lib/auth";
import { getDb, schema } from "@/lib/db/client";

export const runtime = "nodejs";
export const maxDuration = 120;

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.email || !isAdminEmail(session.user.email)) {
    throw new Error("forbidden");
  }
}

interface InsertedImage {
  id: string;
  url: string;
  filename: string;
  bytes: number;
  width?: number;
  height?: number;
}

async function insertImage(args: {
  presetId: string;
  presetSlug: string;
  buffer: Buffer;
  contentType: string;
  filename: string;
}): Promise<InsertedImage> {
  const { presetId, presetSlug, buffer, contentType, filename } = args;
  let width: number | undefined;
  let height: number | undefined;
  try {
    const meta = await sharp(buffer).metadata();
    width = meta.width;
    height = meta.height;
  } catch {
    /* ignore */
  }

  const id = nanoid(12);
  const blobKey = `presets/${presetSlug}/${id}_${filename}`;
  const blob = await put(blobKey, buffer, {
    access: "public",
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
  });

  const db = getDb();
  await db.insert(schema.presetImage).values({
    id,
    presetId,
    url: blob.url,
    blobPathname: blobKey,
    filename,
    sortKey: filename,
    bytes: buffer.byteLength,
    width,
    height,
  });

  return {
    id,
    url: blob.url,
    filename,
    bytes: buffer.byteLength,
    width,
    height,
  };
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id: presetId } = await params;
  const db = getDb();
  const presetRows = await db
    .select()
    .from(schema.preset)
    .where(eq(schema.preset.id, presetId));
  if (presetRows.length === 0) {
    return NextResponse.json({ error: "preset not found" }, { status: 404 });
  }
  const preset = presetRows[0];
  const contentTypeHeader = req.headers.get("content-type") ?? "";

  // JSON body { sourceUrl } — drag-from-existing flow. We fetch the bytes,
  // upload to Blob under the preset namespace, and insert a fresh row.
  if (contentTypeHeader.includes("application/json")) {
    const json = (await req.json().catch(() => ({}))) as {
      sourceUrl?: string;
      filename?: string;
    };
    const sourceUrl = json.sourceUrl;
    if (!sourceUrl || typeof sourceUrl !== "string") {
      return NextResponse.json(
        { error: "expected { sourceUrl }" },
        { status: 400 },
      );
    }
    try {
      const fetched = await fetch(sourceUrl);
      if (!fetched.ok) {
        return NextResponse.json(
          { error: `fetch ${sourceUrl} failed: ${fetched.status}` },
          { status: 400 },
        );
      }
      const contentType = fetched.headers.get("content-type") ?? "image/jpeg";
      const ab = await fetched.arrayBuffer();
      const buffer = Buffer.from(ab);
      const ext =
        contentType === "image/png"
          ? "png"
          : contentType === "image/webp"
            ? "webp"
            : "jpg";
      const baseName =
        json.filename || sourceUrl.split("/").pop() || `image.${ext}`;
      const filename = baseName.includes(".") ? baseName : `${baseName}.${ext}`;
      const inserted = await insertImage({
        presetId,
        presetSlug: preset.slug,
        buffer,
        contentType,
        filename,
      });
      return NextResponse.json({ image: inserted });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // Multipart upload (file picker / drag-drop of local files)
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "must be image/*" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const inserted = await insertImage({
    presetId,
    presetSlug: preset.slug,
    buffer,
    contentType: file.type,
    filename: file.name || `${nanoid(12)}.jpg`,
  });
  return NextResponse.json({ image: inserted });
}
