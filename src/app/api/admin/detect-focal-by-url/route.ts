import { NextResponse } from "next/server";
import { z } from "zod";
import { fetchToBuffer } from "@/lib/storage";
import { detectFocalPoint } from "@/lib/focal-point";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({ imageUrl: z.string().url() });

// One-shot helper used by the Vesperdrop backfill script. Pulls an image from
// a public URL and returns the same focalPoint + faceBox shape that the
// /api/internal/generations endpoint persists.
//
// Auth: bearer token must equal BACKFILL_SECRET. Intentionally simple — this
// is not a long-lived production endpoint, and Vercel OIDC isn't available
// from a local Node script.
export async function POST(req: Request) {
  const expected = process.env.BACKFILL_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "backfill disabled" }, { status: 503 });
  }
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  try {
    const { buffer, mimeType } = await fetchToBuffer(parsed.data.imageUrl);
    const focal = await detectFocalPoint(buffer, mimeType);
    return NextResponse.json(focal);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
