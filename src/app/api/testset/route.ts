import { NextResponse } from "next/server";
import { listTestSet } from "@/lib/testset";

export const dynamic = "force-dynamic";

/** Test setindeki gorselleri ve referans degerlerini dondurur. */
export async function GET() {
  try {
    const items = listTestSet();
    return NextResponse.json({
      items,
      counts: {
        toplam: items.length,
        referansli: items.filter((i) => i.hasGroundTruth).length,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Test seti okunamadi: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
