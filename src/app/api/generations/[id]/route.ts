import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { deleteGeneration, getGeneration } from "@/lib/db";
import { withFocalDefaults } from "@/lib/focal-point";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const generation = await getGeneration(id);
  if (!generation) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ generation: withFocalDefaults(generation) });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const removed = await deleteGeneration(id);
  if (!removed) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (removed.outputUrl && removed.outputUrl.startsWith("https://")) {
    await del(removed.outputUrl).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}
