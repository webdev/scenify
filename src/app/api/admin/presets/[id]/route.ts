import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { del } from "@vercel/blob";
import { auth, isAdminEmail } from "@/lib/auth";
import { getDb, schema } from "@/lib/db/client";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.email || !isAdminEmail(session.user.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id: presetId } = await params;
  const db = getDb();

  // Best-effort Blob cleanup for any reference images still attached.
  const images = await db
    .select({ url: schema.presetImage.url })
    .from(schema.presetImage)
    .where(eq(schema.presetImage.presetId, presetId));
  await Promise.all(
    images.map((r) => (r.url ? del(r.url).catch(() => {}) : Promise.resolve())),
  );

  // Schema has ON DELETE CASCADE so this also drops preset_image rows.
  const deleted = await db
    .delete(schema.preset)
    .where(eq(schema.preset.id, presetId))
    .returning({ id: schema.preset.id });
  if (deleted.length === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
