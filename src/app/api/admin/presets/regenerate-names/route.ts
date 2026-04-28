import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import { auth, isAdminEmail } from "@/lib/auth";
import { getDb, schema } from "@/lib/db/client";
import { generatePresetName } from "@/lib/preset-naming";

export const runtime = "nodejs";
export const maxDuration = 120;

const Body = z.object({
  /** When provided, only regenerate the listed preset ids. Otherwise all presets. */
  presetIds: z.array(z.string().min(1)).optional(),
  /** When true, overwrite even if a description already exists. Default false. */
  force: z.boolean().optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email || !isAdminEmail(session.user.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const json = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(json ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { presetIds, force = false } = parsed.data;

  const db = getDb();
  const rows = presetIds?.length
    ? await db
        .select()
        .from(schema.preset)
        .where(inArray(schema.preset.id, presetIds))
    : await db.select().from(schema.preset);

  const targets = force
    ? rows
    : rows.filter((r) => !r.description || r.description.trim() === "");

  const results: Array<{
    id: string;
    name: string;
    description: string;
    previousName: string;
    previousDescription: string;
  }> = [];

  for (const row of targets) {
    try {
      const generated = await generatePresetName({
        currentName: row.name,
        currentDescription: row.description ?? undefined,
      });
      await db
        .update(schema.preset)
        .set({
          name: generated.name,
          description: generated.description,
          updatedAt: new Date(),
        })
        .where(eq(schema.preset.id, row.id));
      results.push({
        id: row.id,
        name: generated.name,
        description: generated.description,
        previousName: row.name,
        previousDescription: row.description ?? "",
      });
    } catch (err) {
      console.error("regenerate-names: failed for", row.id, err);
    }
  }

  return NextResponse.json({
    updated: results.length,
    skipped: rows.length - targets.length,
    results,
  });
}
