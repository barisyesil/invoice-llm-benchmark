/** Saglayici adaptor turu. Yeni bir OpenAI-uyumlu API icin 'openai' yeterlidir. */
export type ProviderKind = "openai" | "anthropic" | "google";

/** Modelin yapisal cikti (structured output) yetenegi. */
export type StructuredOutputMode = "json_schema" | "json_object" | "none";

export interface ProviderConfig {
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKeyEnv: string;
  headers?: Record<string, string>;
  pricingUrl?: string | null;
}

export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

export interface ModelConfig {
  id: string;
  label: string;
  provider: string;
  model: string;
  structuredOutput: StructuredOutputMode;
  pricing: ModelPricing;
  /** Istek govdesine derin birlestirilecek ek alanlar (thinking, effort, vb.) */
  extra?: Record<string, unknown>;
  /** Istek govdesinden silinecek ust seviye alanlar (or. reasoning modellerde "temperature") */
  omit?: string[];
  /** OpenAI-uyumlu API'lerde token limiti alaninin adi. */
  tokenParam?: "max_tokens" | "max_completion_tokens";
  maxTokens?: number;
  /**
   * Dakikadaki istek limiti (requests per minute). Toplu testte istekler arasi
   * onerilen bekleme suresi bundan hesaplanir: 60 / rpm saniye.
   * Genelde ucretsiz (free tier) limitidir — kendi hesabinizin limitine gore guncelleyin.
   */
  rpm?: number;
  notes?: string;
  enabled: boolean;
}

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  retryOnStatus: number[];
}

export interface AppConfig {
  defaults: {
    maxTokens: number;
    timeoutMs: number;
    currency: string;
    /** Gecici hatalarda (429/503 vb.) otomatik yeniden deneme */
    retry?: RetryConfig;
    /** Toplu testte belgeler arasi bekleme (hiz limitine takilmamak icin) */
    batchDelayMs?: number;
  };
  providers: Record<string, ProviderConfig>;
  models: ModelConfig[];
}

/** Arayuze gonderilen model ozeti (anahtar degeri ASLA gonderilmez). */
export interface ModelSummary {
  id: string;
  label: string;
  provider: string;
  providerLabel: string;
  model: string;
  structuredOutput: StructuredOutputMode;
  pricing: ModelPricing;
  rpm?: number;
  notes?: string;
  /** Ilgili .env anahtari tanimli mi? */
  hasApiKey: boolean;
  apiKeyEnv: string;
}

/** LLM'den beklenen 6 alan. */
export interface ReceiptFields {
  tarih: string;
  fatura_no: string;
  sirket_adi: string;
  toplam_tutar: number;
  tur: string;
  aciklama: string;
}

export type ReceiptFieldName = keyof ReceiptFields;

/**
 * Referans (ground truth) kaydi. Bir alan `null` ise belgede o alan YOKTUR:
 * dogruluk skoruna girmez, bunun yerine "uydurma" metriginde olculur.
 */
export interface GroundTruthEntry {
  kategori?: string;
  not?: string;
  tarih: string | null;
  fatura_no: string | null;
  sirket_adi: string | null;
  toplam_tutar: number | null;
  tur: string | null;
  aciklama: string | null;
  alternatifler?: Partial<Record<ReceiptFieldName, string[]>>;
}

export interface TestSetItem {
  fileName: string;
  kategori: string;
  not?: string;
  hasGroundTruth: boolean;
  groundTruth: GroundTruthEntry | null;
  sizeBytes: number;
}

export interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  /** Saglayici usage dondurmediginde tahmin edildiyse true. */
  estimated: boolean;
}

export interface CostBreakdown {
  inputCost: number;
  outputCost: number;
  totalCost: number;
  currency: string;
  estimated: boolean;
}

/** Provider adaptorlerinin dondurdugu ham sonuc. */
export interface ProviderCallResult {
  url: string;
  httpStatus: number;
  /** Gorsel base64'u kisaltilmis, anahtarlar maskelenmis istek. */
  requestBody: unknown;
  requestHeaders: Record<string, string>;
  responseBody: unknown;
  /** Modelin urettigi ham metin (JSON olmasi beklenir). */
  rawText: string | null;
  usage: TokenUsage;
}

export interface ExtractInput {
  imageBase64: string;
  mediaType: string;
  systemPrompt: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  timeoutMs: number;
}

/** /api/extract yanit sozlesmesi. */
export interface ExtractResponse {
  modelId: string;
  modelLabel: string;
  providerLabel: string;
  ok: boolean;
  /** Ag cagrisinin saf suresi (ms). */
  latencyMs: number;
  parsed: ReceiptFields | null;
  /** JSON parse edilemediyse veya alanlar duzeltildiyse uyarilar. */
  warnings: string[];
  error: string | null;
  usage: TokenUsage;
  cost: CostBreakdown;
  debug: {
    url: string;
    httpStatus: number;
    requestHeaders: Record<string, string>;
    requestBody: unknown;
    responseBody: unknown;
    rawText: string | null;
    imageBytes: number;
    /** Kacinci denemede sonuc alindi (1 = ilk seferde) */
    attempts: number;
    /** Yeniden denemeye yol acan gecici hatalar */
    retriedOn: string[];
  };
}
