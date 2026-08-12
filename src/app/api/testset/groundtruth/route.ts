import { NextResponse } from "next/server";
import { getGroundTruthFor } from "@/lib/testset";

export const dynamic = "force-dynamic";

/**
 * Dosya adina gore referans kaydini dondurur.
 * Kullanici kendi yukledigi dosyalari da test setiyle ayni isimdeyse puanlayabilsin diye.
 */
export async function GET(request: Request) {
  const file = new URL(request.url).searchParams.get("file");
  if (!file) {
    return NextResponse.json({ error: "'file' parametresi gerekli." }, { status: 400 });
  }
  return NextResponse.json({ groundTruth: getGroundTruthFor(file) });
}
