import { NextResponse } from "next/server";
import { listTestProductFilenames } from "@/lib/test-products";

export const runtime = "nodejs";

export async function GET() {
  const filenames = await listTestProductFilenames();
  const products = filenames.map((filename) => ({
    filename,
    url: `/api/test-products/${encodeURIComponent(filename)}`,
  }));
  return NextResponse.json({ products });
}
