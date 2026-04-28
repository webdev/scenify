import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth, isAdminEmail } from "@/lib/auth";
import { getDb, schema } from "@/lib/db/client";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ imageId: string }> },
) {
  const session = await auth();
  if (!session?.user?.email || !isAdminEmail(session.user.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { imageId } = await params;
  const body = await req.json().catch(() => ({}));
  const explicit =
    typeof body?.favorited === "boolean" ? (body.favorited as boolean) : null;

  const db = getDb();
  const rows = await db
    .select({ favorited: schema.presetImage.favorited })
    .from(schema.presetImage)
    .where(eq(schema.presetImage.id, imageId));
  if (rows.length === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const next = explicit ?? !rows[0].favorited;

  await db
    .update(schema.presetImage)
    .set({ favorited: next })
    .where(eq(schema.presetImage.id, imageId));

  return NextResponse.json({ favorited: next });
}
