import type {
  ExtractInput,
  ModelConfig,
  ProviderCallResult,
  ProviderConfig,
  ProviderKind,
} from "../types";
import { callOpenAiCompatible } from "./openai";
import { callAnthropic } from "./anthropic";
import { callGoogle } from "./google";

export type ProviderAdapter = (
  model: ModelConfig,
  provider: ProviderConfig,
  apiKey: string,
  input: ExtractInput
) => Promise<ProviderCallResult>;

/**
 * Adaptor kayit defteri.
 *
 * Yeni bir saglayici turu eklemek icin:
 *   1. ./yeni-saglayici.ts icinde ProviderAdapter imzasinda bir fonksiyon yazin,
 *   2. asagidaki haritaya ekleyin,
 *   3. types.ts icindeki ProviderKind birlesimine adini ekleyin.
 * OpenAI-uyumlu bir API ise hicbiri gerekmez — config'te kind:"openai" yeterli.
 */
const ADAPTERS: Record<ProviderKind, ProviderAdapter> = {
  openai: callOpenAiCompatible,
  anthropic: callAnthropic,
  google: callGoogle,
};

export function getAdapter(kind: ProviderKind): ProviderAdapter {
  const adapter = ADAPTERS[kind];
  if (!adapter) {
    throw new Error(
      `Desteklenmeyen saglayici turu: "${kind}". Desteklenenler: ${Object.keys(ADAPTERS).join(", ")}`
    );
  }
  return adapter;
}
