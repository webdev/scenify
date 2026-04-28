import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { createPreset, deletePreset } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const db = getDb();
  const presets = await db.select().from(schema.preset);

  const presetsWithCounts = await Promise.all(
    presets.map(async (p) => {
      const allImages = await db
        .select({ url: schema.presetImage.url })
        .from(schema.presetImage)
        .where(eq(schema.presetImage.presetId, p.id));
      return {
        ...p,
        imageCount: allImages.length,
        thumbs: allImages.slice(0, 3).map((r) => r.url),
      };
    }),
  );

  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <li className="overflow-hidden rounded-lg border border-dashed border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900">
        <form action={createPreset} className="flex h-full flex-col p-5">
          <div className="text-sm font-medium">New preset</div>
          <div className="mt-3 space-y-2">
            <input
              name="name"
              type="text"
              required
              placeholder="Display name"
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
            <input
              name="slug"
              type="text"
              placeholder="slug (auto from name if blank)"
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
            <textarea
              name="description"
              rows={2}
              placeholder="Description (optional)"
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          </div>
          <button
            type="submit"
            className="mt-3 rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
          >
            + Create preset
          </button>
        </form>
      </li>

      {presetsWithCounts.map((p) => (
        <li
          key={p.id}
          className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
        >
          <Link
            href={`/admin/presets/${p.slug}`}
            className="block aspect-[3/2] grid-cols-3 gap-px bg-zinc-200 dark:bg-zinc-800"
            style={{ display: "grid" }}
          >
            {p.thumbs.length === 0 ? (
              <div className="col-span-3 flex items-center justify-center bg-zinc-100 text-xs text-zinc-500 dark:bg-zinc-950">
                no images yet
              </div>
            ) : (
              p.thumbs.map((u) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={u}
                  src={u}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ))
            )}
          </Link>
          <div className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href={`/admin/presets/${p.slug}`}
                  className="block truncate text-sm font-medium hover:underline"
                >
                  {p.name}
                </Link>
                <div className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">
                  {p.slug}
                </div>
              </div>
              <div className="text-[11px] text-zinc-500">{p.imageCount} img</div>
            </div>
            {p.description && (
              <p className="mt-2 line-clamp-2 text-[11px] text-zinc-500">
                {p.description}
              </p>
            )}
            <div className="mt-3 flex items-center justify-between">
              <Link
                href={`/admin/presets/${p.slug}`}
                className="text-xs underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                Manage images →
              </Link>
              <DeletePresetForm presetId={p.id} slug={p.slug} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function DeletePresetForm({
  presetId,
  slug,
}: {
  presetId: string;
  slug: string;
}) {
  async function action() {
    "use server";
    await deletePreset(presetId);
  }
  return (
    <form action={action}>
      <button
        type="submit"
        className="text-xs text-rose-600 underline underline-offset-2 hover:text-rose-800 dark:text-rose-400"
        title={`Permanently delete preset "${slug}" and all its images`}
      >
        Delete
      </button>
    </form>
  );
}
