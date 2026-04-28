import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, asc } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import PresetImageUploader from "./uploader";
import PresetImageRows from "@/components/preset-image-rows";

export const dynamic = "force-dynamic";

export default async function PresetDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const db = getDb();
  const presets = await db
    .select()
    .from(schema.preset)
    .where(eq(schema.preset.slug, slug));
  if (presets.length === 0) notFound();
  const preset = presets[0];

  const images = await db
    .select()
    .from(schema.presetImage)
    .where(eq(schema.presetImage.presetId, preset.id))
    .orderBy(asc(schema.presetImage.sortKey));

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/admin"
            className="text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            ← All presets
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            {preset.name}
          </h1>
          <p className="mt-0.5 font-mono text-xs text-zinc-500">{preset.slug}</p>
          {preset.description && (
            <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
              {preset.description}
            </p>
          )}
        </div>
        <div className="text-xs text-zinc-500">{images.length} images</div>
      </div>

      <PresetImageUploader presetId={preset.id} slug={preset.slug} />

      {images.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-12 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No images yet. Drop files in the uploader above.
        </div>
      ) : (
        <PresetImageRows
          presetId={preset.id}
          items={images.map((img) => ({
            id: img.id,
            url: img.url,
            width: img.width ?? 1024,
            height: img.height ?? 1024,
            filename: img.filename ?? "",
            caption: img.filename ?? img.sortKey ?? "",
          }))}
        />
      )}
    </div>
  );
}

