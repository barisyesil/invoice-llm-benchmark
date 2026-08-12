import fs from "node:fs";
import { NextResponse } from "next/server";
import { resolveTestSetImage } from "@/lib/testset";

export const dynamic = "force-dynamic";

/** Test seti gorselini servis eder (onizleme / kucuk resim icin). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const resolved = resolveTestSetImage(decodeURIComponent(name));

  if (!resolved) {
    return NextResponse.json({ error: "Gorsel bulunamadi." }, { status: 404 });
  }

  const bytes = fs.readFileSync(resolved.fullPath);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": resolved.mediaType,
      "cache-control": "public, max-age=3600",
    },
  });
}
