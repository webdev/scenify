import { NextResponse } from "next/server";
import { auth, isAdminEmail } from "@/lib/auth";
import { getGeneration, updateGeneration } from "@/lib/db";
import { fetchToBuffer } from "@/lib/storage";
import { detectFocalPoint } from "@/lib/focal-point";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.email || !isAdminEmail(session.user.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const gen = await getGeneration(id);
  if (!gen) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (gen.status !== "succeeded" || !gen.outputUrl) {
    return NextResponse.json(
      { error: "generation must be succeeded with an output" },
      { status: 400 },
    );
  }

  const { buffer, mimeType } = await fetchToBuffer(gen.outputUrl);
  const focal = await detectFocalPoint(buffer, mimeType);

  const updated = await updateGeneration(id, {
    focalPoint: focal.focalPoint,
    faceBox: focal.faceBox,
  });

  return NextResponse.json({
    generation: updated,
    focalPoint: focal.focalPoint,
    faceBox: focal.faceBox,
  });
}
