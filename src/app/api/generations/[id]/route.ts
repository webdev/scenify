import { NextResponse } from "next/server";
import { getGeneration } from "@/lib/db";
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
