import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { del } from "@vercel/blob";
import { auth, isAdminEmail } from "@/lib/auth";
import { getDb, schema } from "@/lib/db/client";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ imageId: string }> },
) {
  const session = await auth();
  if (!session?.user?.email || !isAdminEmail(session.user.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { imageId } = await params;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.presetImage)
    .where(eq(schema.presetImage.id, imageId));
  if (rows.length === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const row = rows[0];
  if (row.url) {
    await del(row.url).catch(() => {});
  }
  await db
    .delete(schema.presetImage)
    .where(eq(schema.presetImage.id, imageId));
  return NextResponse.json({ ok: true });
}
