import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { del } from "@vercel/blob";
import { auth, isAdminEmail } from "@/lib/auth";
import { getDb, schema } from "@/lib/db/client";

export const runtime = "nodejs";
export const maxDuration = 60;

const PatchBody = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  isPro: z.boolean().optional(),
  isWip: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.email || !isAdminEmail(session.user.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id: presetId } = await params;
  const json = await req.json().catch(() => null);
  const parsed = PatchBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const patch = parsed.data;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }
  const db = getDb();
  const updated = await db
    .update(schema.preset)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.preset.id, presetId))
    .returning({
      id: schema.preset.id,
      slug: schema.preset.slug,
      name: schema.preset.name,
      description: schema.preset.description,
      isPro: schema.preset.isPro,
      isWip: schema.preset.isWip,
    });
  if (updated.length === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ preset: updated[0] });
}

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
