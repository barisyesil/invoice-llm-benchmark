import { NextResponse } from "next/server";
import { getApiKey, loadConfig } from "@/lib/config";
import type { ModelSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Arayuze model listesini dondurur. API anahtarlarinin DEGERI asla gonderilmez. */
export async function GET() {
  try {
    const { config } = loadConfig();

    const models: ModelSummary[] = config.models
      .filter((m) => m.enabled)
      .map((m) => {
        const provider = config.providers[m.provider];
        return {
          id: m.id,
          label: m.label,
          provider: m.provider,
          providerLabel: provider.label,
          model: m.model,
          structuredOutput: m.structuredOutput,
          pricing: m.pricing,
          rpm: m.rpm,
          notes: m.notes,
          hasApiKey: getApiKey(provider) !== null,
          apiKeyEnv: provider.apiKeyEnv,
        };
      });

    return NextResponse.json({ models, defaults: config.defaults });
  } catch (err) {
    return NextResponse.json(
      { error: `Konfigurasyon okunamadi: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
