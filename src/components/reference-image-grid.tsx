"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RowsPhotoAlbum } from "react-photo-album";
import "react-photo-album/rows.css";
import type { PresetReferenceImage } from "@/lib/types";

interface Props {
  items: PresetReferenceImage[];
  selectedUrls: Set<string>;
  onToggleSelect: (url: string) => void;
  onInspect?: (url: string) => void;
  /** When true, hovering an image reveals a small delete (×) button. */
  enableDelete?: boolean;
  /** When true, shows a heart toggle for favoriting. */
  enableFavorite?: boolean;
  /** Override sizing knobs (used by the small "Favorites" strip). */
  targetRowHeight?: number;
  spacing?: number;
  /** Source preset's DB id — set when dragged images should be MOVED to the
   * drop target's preset (not cloned). */
  sourcePresetDbId?: string;
}

export default function ReferenceImageGrid({
  items,
  selectedUrls,
  onToggleSelect,
  onInspect,
  enableDelete = false,
  enableFavorite = false,
  targetRowHeight = 260,
  spacing = 12,
  sourcePresetDbId,
}: Props) {
  return (
    <RowsPhotoAlbum
      photos={items.map((it) => ({
        src: it.url,
        width: it.width,
        height: it.height,
        alt: it.filename,
        key: it.id,
        item: it,
      }))}
      targetRowHeight={targetRowHeight}
      spacing={spacing}
      defaultContainerWidth={1100}
      render={{
        extras: (_, ctx) => {
          const item = (ctx.photo as unknown as { item: PresetReferenceImage })
            .item;
          const isSel = selectedUrls.has(item.url);
          return (
            <>
              {/* Click overlay handles selection AND drag start. Sits
                * below the overlay buttons (z-10) so heart/inspect/delete
                * intercept clicks. */}
              <div
                className="absolute inset-0 cursor-pointer"
                onClick={() => onToggleSelect(item.url)}
                aria-label={isSel ? "Deselect" : "Select"}
                role="button"
                draggable
                onDragStart={(e) => {
                  // If the dragged image is part of the multi-selection,
                  // drag the whole set. Otherwise drag just this one.
                  const dragSet =
                    isSel && selectedUrls.size > 0
                      ? items.filter((i) => selectedUrls.has(i.url))
                      : [item];
                  const ids = dragSet.map((i) => i.id);
                  const urls = dragSet.map((i) => i.url);
                  const movePayload = JSON.stringify({
                    ids,
                    sourcePresetDbId: sourcePresetDbId ?? null,
                  });
                  e.dataTransfer.setData("text/uri-list", urls.join("\n"));
                  // Backup channel: prefix-encoded move payload in text/plain.
                  // Some browsers / Safari strip custom MIME types; we still
                  // recover the move intent from this marker on drop.
                  e.dataTransfer.setData(
                    "text/plain",
                    `__sceneify-move__${movePayload}`,
                  );
                  e.dataTransfer.setData(
                    "application/x-sceneify-image-ids",
                    movePayload,
                  );
                  // "copyMove" so the chip's dragover dropEffect ("copy")
                  // doesn't mismatch and silently block the drop.
                  e.dataTransfer.effectAllowed = "copyMove";

                  // Custom drag image — when dragging multiple, render a
                  // small stack of thumbs with a count badge so the user
                  // sees the whole selection moving, not just one image.
                  if (dragSet.length > 1) {
                    const stack = document.createElement("div");
                    stack.style.cssText =
                      "position:absolute;top:-1000px;left:-1000px;width:128px;height:128px;pointer-events:none;font-family:system-ui,sans-serif;";
                    const visible = dragSet.slice(0, 3);
                    visible.forEach((img, i) => {
                      const tile = document.createElement("div");
                      const offset = i * 6;
                      tile.style.cssText = `position:absolute;top:${offset}px;left:${offset}px;width:96px;height:96px;border-radius:8px;border:2px solid white;box-shadow:0 4px 12px rgba(0,0,0,0.3);background-image:url('${img.url}');background-size:cover;background-position:center;transform:rotate(${(i - 1) * 4}deg);`;
                      stack.appendChild(tile);
                    });
                    const badge = document.createElement("div");
                    badge.textContent = `+${dragSet.length}`;
                    badge.style.cssText =
                      "position:absolute;bottom:0;right:0;min-width:32px;height:28px;padding:0 8px;border-radius:14px;background:#10b981;color:white;font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,0.3);border:2px solid white;";
                    stack.appendChild(badge);
                    document.body.appendChild(stack);
                    e.dataTransfer.setDragImage(stack, 64, 64);
                    // Browser captures the element synchronously after this
                    // handler returns; remove on next tick.
                    window.setTimeout(() => stack.remove(), 0);
                  }
                }}
              />
              {isSel && (
                <span className="pointer-events-none absolute inset-0 rounded-[inherit] ring-2 ring-emerald-500 ring-offset-0" />
              )}
              {enableFavorite && (
                <FavoriteButton
                  imageId={item.id}
                  initial={item.favorited}
                />
              )}
              {isSel && (
                <span className="pointer-events-none absolute bottom-1.5 left-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white shadow">
                  <svg
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    className="h-3.5 w-3.5"
                    aria-hidden="true"
                  >
                    <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7 7a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 1 1 1.06-1.06L6.25 10.69l6.47-6.47a.75.75 0 0 1 1.06 0z" />
                  </svg>
                </span>
              )}
              {onInspect && (
                <InspectButton
                  onClick={(e) => {
                    e.stopPropagation();
                    onInspect(item.url);
                  }}
                />
              )}
              {enableDelete && <DeleteButton imageId={item.id} />}
            </>
          );
        },
      }}
    />
  );
}

function InspectButton({
  onClick,
}: {
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-album-inspect-btn
      aria-label="View image prompt"
      title="View image prompt"
      className="absolute right-1.5 top-1.5 z-10 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/85 text-zinc-700 opacity-0 shadow transition hover:bg-white dark:bg-zinc-900/80 dark:text-zinc-200 dark:hover:bg-zinc-900"
    >
      <svg
        viewBox="0 0 16 16"
        fill="currentColor"
        className="h-3.5 w-3.5"
        aria-hidden="true"
      >
        <path d="M8 3a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm-1.25 3.5h2v6h-2v-6z" />
      </svg>
    </button>
  );
}

function FavoriteButton({
  imageId,
  initial,
}: {
  imageId: string;
  initial: boolean;
}) {
  const router = useRouter();
  const [favorited, setFavorited] = useState(initial);
  const [, startTransition] = useTransition();
  return (
    <button
      type="button"
      data-album-favorite-btn={favorited ? "on" : "off"}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const next = !favorited;
        setFavorited(next); // optimistic
        try {
          const res = await fetch(
            `/api/admin/preset-images/${imageId}/favorite`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ favorited: next }),
            },
          );
          if (!res.ok) throw new Error(await res.text());
          startTransition(() => router.refresh());
        } catch (err) {
          setFavorited(!next); // rollback
          alert(`Favorite failed: ${err instanceof Error ? err.message : err}`);
        }
      }}
      aria-label={favorited ? "Unfavorite" : "Favorite"}
      title={favorited ? "Unfavorite" : "Favorite"}
      className={`absolute left-1.5 top-1.5 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full shadow backdrop-blur transition ${
        favorited
          ? "bg-rose-500/95 text-white opacity-100"
          : "bg-black/55 text-white opacity-0 hover:bg-rose-500"
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        fill={favorited ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        className="h-4 w-4"
        aria-hidden="true"
      >
        <path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6.5 5.5 5.5 0 0 1 21.5 12c-2.5 4.5-9.5 9-9.5 9z" />
      </svg>
    </button>
  );
}

function DeleteButton({ imageId }: { imageId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      data-album-delete-btn
      disabled={busy}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (busy) return;
        if (!confirm("Delete this reference image?")) return;
        setBusy(true);
        try {
          const res = await fetch(`/api/admin/preset-images/${imageId}`, {
            method: "DELETE",
          });
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
      className="absolute bottom-1.5 right-1.5 z-10 inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs font-semibold text-white opacity-0 shadow backdrop-blur transition hover:bg-rose-600 disabled:opacity-50"
    >
      ×
    </button>
  );
}
