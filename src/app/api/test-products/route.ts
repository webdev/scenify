import { NextResponse } from "next/server";
import { listTestProducts } from "@/lib/test-products";

export const runtime = "nodejs";

export async function GET() {
  const products = await listTestProducts();
  // Field name `filename` kept stable for the existing dashboard. The `url`
  // is now a Vercel Blob URL (no longer a proxy through this API).
  return NextResponse.json({ products });
}
