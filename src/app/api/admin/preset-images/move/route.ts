import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import { auth, isAdminEmail } from "@/lib/auth";
import { getDb, schema } from "@/lib/db/client";

export const runtime = "nodejs";

const Body = z.object({
  imageIds: z.array(z.string().min(1)).min(1),
  targetPresetId: z.string().min(1),
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
  const { imageIds, targetPresetId } = parsed.data;

  const db = getDb();
  const targetPreset = await db
    .select()
    .from(schema.preset)
    .where(eq(schema.preset.id, targetPresetId));
  if (targetPreset.length === 0) {
    return NextResponse.json(
      { error: "target preset not found" },
      { status: 404 },
    );
  }

  // Reassign each preset_image's preset_id. Blob URLs stay where they are
  // (no clone, no extra storage). The row's namespace is now the new preset.
  await db
    .update(schema.presetImage)
    .set({ presetId: targetPresetId })
    .where(inArray(schema.presetImage.id, imageIds));

  return NextResponse.json({ moved: imageIds.length });
}
