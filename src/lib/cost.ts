import type { CostBreakdown, ModelConfig, TokenUsage } from "./types";

/**
 * Gorsel token tahmini (saglayici usage dondurmediginde kullanilir).
 *
 * ONEMLI: Bu sadece bir YEDEK tahmindir. Saglayicilarin cogu usage.input_tokens
 * icinde gorsel tokenlarini zaten raporlar; o durumda gercek deger kullanilir ve
 * "estimated" false olur. Arayuz tahmini degerleri "~" isaretiyle gosterir.
 *
 * Yaklasik olarak 750 base64 karakteri ~ 1 gorsel token kabul ediliyor
 * (1024x1024 bir JPEG ~ 1.4M karakter base64, saglayicilarda ~1100-1600 token).
 */
export function estimateImageTokens(base64Length: number): number {
  return Math.ceil(base64Length / 750);
}

/** Metin icin kaba token tahmini (~4 karakter = 1 token). */
export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function computeCost(
  model: ModelConfig,
  usage: TokenUsage,
  currency: string
): CostBreakdown {
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;

  const inputCost = (input / 1_000_000) * model.pricing.inputPer1M;
  const outputCost = (output / 1_000_000) * model.pricing.outputPer1M;

  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
    currency,
    estimated: usage.estimated,
  };
}

/** Cok kucuk tutarlari da okunabilir gosterir: $0.000842 */
export function formatCost(value: number, currency = "USD"): string {
  const symbol = currency === "USD" ? "$" : `${currency} `;
  if (value === 0) return `${symbol}0`;
  if (value < 0.01) return `${symbol}${value.toFixed(6)}`;
  return `${symbol}${value.toFixed(4)}`;
}

/** 1000 fis islenirse ne kadar tutar — PoC'de en cok merak edilen sayi. */
export function projectCost(perCall: number, count = 1000): number {
  return perCall * count;
}
