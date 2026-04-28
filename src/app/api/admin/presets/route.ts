import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { auth, isAdminEmail } from "@/lib/auth";
import { getDb, schema } from "@/lib/db/client";

export const runtime = "nodejs";

const Body = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().optional(),
  description: z.string().max(500).optional(),
});

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

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
  const { name, slug: rawSlug, description = "" } = parsed.data;
  const slug = slugify(rawSlug || name);
  if (!slug) {
    return NextResponse.json(
      { error: "could not derive slug" },
      { status: 400 },
    );
  }

  const db = getDb();
  const existing = await db
    .select()
    .from(schema.preset)
    .where(eq(schema.preset.slug, slug));
  if (existing.length > 0) {
    return NextResponse.json(
      { error: `slug "${slug}" already exists` },
      { status: 409 },
    );
  }
  const id = nanoid(12);
  await db.insert(schema.preset).values({ id, slug, name, description });
  return NextResponse.json({
    preset: { id, slug, name, description },
  });
}
