import { NextResponse } from "next/server";
import { z } from "zod";
import { inArray } from "drizzle-orm";
import { auth, isAdminEmail } from "@/lib/auth";
import { getDb, schema } from "@/lib/db/client";

export const runtime = "nodejs";
export const maxDuration = 120;

const Body = z.object({
  imageIds: z.array(z.string().min(1)).min(1).max(500),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email || !isAdminEmail(session.user.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { imageIds } = parsed.data;

  const db = getDb();
  const result = await db
    .delete(schema.presetImage)
    .where(inArray(schema.presetImage.id, imageIds))
    .returning({ id: schema.presetImage.id });

  return NextResponse.json({ deleted: result.length });
}
