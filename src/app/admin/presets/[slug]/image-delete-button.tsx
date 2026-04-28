"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ImageDeleteButton({
  presetId,
  imageId,
}: {
  presetId: string;
  imageId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (busy) return;
        setBusy(true);
        try {
          const res = await fetch(
            `/api/admin/presets/${presetId}/images/${imageId}`,
            { method: "DELETE" },
          );
          if (!res.ok) throw new Error(await res.text());
          router.refresh();
        } catch (err) {
          alert(`Delete failed: ${err instanceof Error ? err.message : err}`);
        } finally {
          setBusy(false);
        }
      }}
      aria-label="Delete image"
      title="Delete image"
      data-album-delete-btn
      className="absolute right-1.5 top-1.5 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-sm font-semibold text-white opacity-0 shadow-md backdrop-blur transition hover:bg-rose-600 disabled:opacity-50"
    >
      ×
    </button>
  );
}
