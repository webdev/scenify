import { NextResponse } from "next/server";
import { loadPublicPresets } from "@/lib/presets";

export const runtime = "nodejs";

export async function GET() {
  const presets = await loadPublicPresets();
  return NextResponse.json(
    { presets },
    {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
      },
    },
  );
}
