"use client";

import { RowsPhotoAlbum } from "react-photo-album";
import "react-photo-album/rows.css";
import ImageDeleteButton from "@/app/admin/presets/[slug]/image-delete-button";

export interface PresetImageRowsItem {
  id: string;
  url: string;
  width: number;
  height: number;
  filename: string;
  caption: string;
}

interface Props {
  presetId: string;
  items: PresetImageRowsItem[];
}

export default function PresetImageRows({ presetId, items }: Props) {
  return (
    <RowsPhotoAlbum
      photos={items.map((it) => ({
        src: it.url,
        width: it.width,
        height: it.height,
        alt: it.filename,
        key: it.id,
        // Pass-through metadata for the render function below.
        item: it,
      }))}
      targetRowHeight={260}
      spacing={12}
      defaultContainerWidth={1100}
      render={{
        extras: (_, ctx) => {
          const item = (ctx.photo as unknown as { item: PresetImageRowsItem })
            .item;
          return (
            <>
              <ImageDeleteButton presetId={presetId} imageId={item.id} />
              <div
                className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/60 to-transparent px-2 py-1 text-[10px] text-white"
                title={item.caption}
              >
                {item.caption}
              </div>
            </>
          );
        },
      }}
    />
  );
}
