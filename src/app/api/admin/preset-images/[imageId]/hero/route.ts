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
  const explicit = typeof body?.hero === "boolean" ? (body.hero as boolean) : null;

  const db = getDb();
  const rows = await db
    .select({
      url: schema.presetImage.url,
      presetId: schema.presetImage.presetId,
    })
    .from(schema.presetImage)
    .where(eq(schema.presetImage.id, imageId));
  if (rows.length === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const { url, presetId } = rows[0];

  const presetRows = await db
    .select({ heroImageUrl: schema.preset.heroImageUrl })
    .from(schema.preset)
    .where(eq(schema.preset.id, presetId));
  const currentHero = presetRows[0]?.heroImageUrl ?? null;

  const isCurrent = currentHero === url;
  const next = explicit ?? !isCurrent;

  const newHeroUrl = next ? url : null;
  await db
    .update(schema.preset)
    .set({ heroImageUrl: newHeroUrl, updatedAt: new Date() })
    .where(eq(schema.preset.id, presetId));

  return NextResponse.json({ hero: next, heroImageUrl: newHeroUrl });
}
