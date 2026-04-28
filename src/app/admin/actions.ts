"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { del } from "@vercel/blob";
import { nanoid } from "nanoid";
import { auth, isAdminEmail } from "@/lib/auth";
import { getDb, schema } from "@/lib/db/client";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.email || !isAdminEmail(session.user.email)) {
    throw new Error("forbidden");
  }
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export async function createPreset(formData: FormData) {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const slugRaw = String(formData.get("slug") ?? "").trim();
  if (!name) {
    throw new Error("name is required");
  }
  const slug = slugify(slugRaw || name);
  if (!slug) {
    throw new Error("could not derive slug");
  }
  const db = getDb();
  const existing = await db
    .select()
    .from(schema.preset)
    .where(eq(schema.preset.slug, slug));
  if (existing.length > 0) {
    throw new Error(`slug "${slug}" already exists`);
  }
  await db
    .insert(schema.preset)
    .values({ id: nanoid(12), slug, name, description });
  revalidatePath("/admin");
  redirect(`/admin/presets/${slug}`);
}

export async function deletePreset(presetId: string) {
  await requireAdmin();
  const db = getDb();
  const images = await db
    .select()
    .from(schema.presetImage)
    .where(eq(schema.presetImage.presetId, presetId));
  for (const img of images) {
    if (img.url) {
      await del(img.url).catch(() => {});
    }
  }
  await db.delete(schema.preset).where(eq(schema.preset.id, presetId));
  revalidatePath("/admin");
  revalidatePath("/");
}

export async function deletePresetImage(imageId: string) {
  await requireAdmin();
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.presetImage)
    .where(eq(schema.presetImage.id, imageId));
  if (rows.length === 0) return;
  const row = rows[0];
  if (row.url) {
    await del(row.url).catch(() => {});
  }
  await db
    .delete(schema.presetImage)
    .where(eq(schema.presetImage.id, imageId));
  revalidatePath("/admin");
  revalidatePath("/");
}
