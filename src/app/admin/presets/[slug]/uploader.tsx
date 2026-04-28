"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  presetId: string;
  slug: string;
}

export default function PresetImageUploader({ presetId, slug }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(0);
  const [done, setDone] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragActive, setDragActive] = useState(false);

  const upload = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files).filter((f) =>
        f.type.startsWith("image/"),
      );
      if (list.length === 0) return;
      setPending(list.length);
      setDone(0);
      setErrors([]);

      const concurrency = 4;
      let cursor = 0;
      const failures: string[] = [];

      const worker = async () => {
        while (cursor < list.length) {
          const i = cursor++;
          const file = list[i];
          const fd = new FormData();
          fd.set("file", file);
          try {
            const res = await fetch(`/api/admin/presets/${presetId}/images`, {
              method: "POST",
              body: fd,
            });
            if (!res.ok) {
              const text = await res.text().catch(() => "");
              failures.push(`${file.name}: ${res.status} ${text.slice(0, 100)}`);
            }
          } catch (err) {
            failures.push(`${file.name}: ${(err as Error).message}`);
          } finally {
            setDone((d) => d + 1);
          }
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(concurrency, list.length) }, () =>
          worker(),
        ),
      );

      setErrors(failures);
      router.refresh();
    },
    [presetId, router],
  );

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Add reference images to {slug}
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Drag-drop, or click below. Each file uploads to Vercel Blob and
            inserts a preset_image row. JPEG / PNG / WebP, no per-file size cap
            other than what the browser allows.
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) upload(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          if (e.dataTransfer.files) upload(e.dataTransfer.files);
        }}
        className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 text-center transition ${
          dragActive
            ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30"
            : "border-zinc-300 hover:border-zinc-500 dark:border-zinc-700"
        }`}
      >
        <div className="text-sm font-medium">
          {pending > 0
            ? `Uploading ${done} / ${pending}…`
            : "Drop images here, or click to pick"}
        </div>
        <div className="mt-1 text-[11px] text-zinc-500">
          Multiple files supported. Uploads run 4 in parallel.
        </div>
      </div>

      {errors.length > 0 && (
        <div className="mt-3 rounded-md border border-rose-300 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">
          <div className="font-medium">{errors.length} failed</div>
          <ul className="mt-1 list-disc pl-4">
            {errors.slice(0, 5).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
            {errors.length > 5 && <li>…and {errors.length - 5} more</li>}
          </ul>
        </div>
      )}

      {pending > 0 && done === pending && errors.length === 0 && (
        <div className="mt-3 text-xs text-emerald-700 dark:text-emerald-400">
          {pending} image{pending === 1 ? "" : "s"} uploaded.
        </div>
      )}
    </div>
  );
}
