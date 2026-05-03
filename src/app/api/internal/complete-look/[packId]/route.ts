import { NextResponse } from "next/server";
import { listGenerationsByPackId } from "@/lib/db";
import { readBearer, verifyVercelOidc } from "@/lib/oidc-verify";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ packId: string }> },
) {
  const token = readBearer(req);
  if (!token) {
    return NextResponse.json(
      { error: "missing bearer token" },
      { status: 401 },
    );
  }
  const verified = await verifyVercelOidc(token);
  if (!verified.ok) {
    return NextResponse.json(
      { error: "unauthorized", detail: verified.reason },
      { status: 401 },
    );
  }

  const { packId } = await params;
  const rows = await listGenerationsByPackId(packId);
  if (rows.length === 0) {
    return NextResponse.json({ error: "pack not found" }, { status: 404 });
  }

  rows.sort((a, b) => (a.packShotIndex ?? 0) - (b.packShotIndex ?? 0));

  const succeeded = rows.filter((r) => r.status === "succeeded").length;
  const failed = rows.filter((r) => r.status === "failed").length;
  const pending = rows.length - succeeded - failed;
  const done = pending === 0;
  const parentGenerationId = rows[0].parentGenerationId ?? null;
  const platform = rows[0].packPlatform ?? null;

  return NextResponse.json({
    packId,
    parentGenerationId,
    platform,
    total: rows.length,
    succeeded,
    failed,
    pending,
    done,
    shots: rows.map((r) => ({
      generationId: r.id,
      role: r.packRole,
      shotIndex: r.packShotIndex,
      sizeProfile: r.sizeProfile,
      status: r.status,
      outputUrl: r.outputUrl ?? null,
      error: r.error ?? null,
      seed: r.seed,
      colorMaxDeltaE: r.colorMaxDeltaE ?? null,
      focalPoint: r.focalPoint ?? { x: 0.5, y: 0.5, confidence: 1, source: "center" },
      faceBox: r.faceBox ?? null,
    })),
    callerProjectId: verified.claims.project_id,
  });
}
