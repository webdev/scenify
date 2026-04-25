import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { addSource, listSources } from "@/lib/db";
import { saveBufferAsImage } from "@/lib/storage";
import { readTestProduct } from "@/lib/test-products";
import type { Source } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  const sources = await listSources();
  return NextResponse.json({ sources });
}

async function importFromTestProduct(filename: string): Promise<Source> {
  const { buffer, mimeType } = await readTestProduct(filename);
  const stored = await saveBufferAsImage(buffer, mimeType, "src");
  const source: Source = {
    id: nanoid(12),
    url: stored.url,
    filename,
    mimeType,
    createdAt: new Date().toISOString(),
  };
  await addSource(source);
  return source;
}

export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const json = await req.json().catch(() => null);
    const testProductFilename = json?.testProductFilename;
    if (typeof testProductFilename !== "string") {
      return NextResponse.json(
        { error: "expected { testProductFilename }" },
        { status: 400 },
      );
    }
    try {
      const source = await importFromTestProduct(testProductFilename);
      return NextResponse.json({ source });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "file must be an image" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const stored = await saveBufferAsImage(buffer, file.type, "src");

  const source: Source = {
    id: nanoid(12),
    url: stored.url,
    filename: file.name || stored.filename,
    mimeType: stored.mimeType,
    createdAt: new Date().toISOString(),
  };
  await addSource(source);
  return NextResponse.json({ source });
}
