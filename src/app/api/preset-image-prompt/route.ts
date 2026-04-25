import { NextResponse } from "next/server";
import { describePresetImage } from "@/lib/describe-image";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const imagePath = url.searchParams.get("path");
  const force = url.searchParams.get("force") === "1";

  if (!imagePath) {
    return NextResponse.json({ error: "missing path" }, { status: 400 });
  }
  if (!imagePath.startsWith("/presets/") || imagePath.includes("..")) {
    return NextResponse.json({ error: "path must be /presets/..." }, { status: 400 });
  }

  try {
    const { prompt, cached } = await describePresetImage(imagePath, { force });
    return NextResponse.json({ path: imagePath, prompt, cached });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    const cause = err instanceof Error && err.cause ? String(err.cause) : undefined;
    console.error("preset-image-prompt error:", { message, cause, stack });
    return NextResponse.json({ error: message, cause }, { status: 500 });
  }
}
