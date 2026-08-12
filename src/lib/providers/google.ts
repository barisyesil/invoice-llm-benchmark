import type {
  ExtractInput,
  ModelConfig,
  ProviderCallResult,
  ProviderConfig,
} from "../types";
import {
  deepMerge,
  fetchWithTimeout,
  isPlainObject,
  readBody,
  redactBase64,
  redactHeaders,
} from "../utils";

/**
 * Google Gemini generateContent (ham HTTP).
 *
 * API anahtari sorgu parametresi yerine `x-goog-api-key` basligiyla gonderiliyor —
 * anahtar URL'de gorunmez, loglara sizmaz.
 */
export async function callGoogle(
  model: ModelConfig,
  provider: ProviderConfig,
  apiKey: string,
  input: ExtractInput
): Promise<ProviderCallResult> {
  const url = `${provider.baseUrl.replace(/\/$/, "")}/models/${model.model}:generateContent`;

  const generationConfig: Record<string, unknown> = {
    temperature: 0,
    maxOutputTokens: input.maxTokens,
  };

  if (model.structuredOutput === "json_schema") {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = toGeminiSchema(input.schema);
  } else if (model.structuredOutput === "json_object") {
    generationConfig.responseMimeType = "application/json";
  }

  let body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: input.systemPrompt }] },
    contents: [
      {
        role: "user",
        parts: [
          { text: "Bu fisi analiz et ve istenen JSON nesnesini dondur." },
          { inline_data: { mime_type: input.mediaType, data: input.imageBase64 } },
        ],
      },
    ],
    generationConfig,
  };

  for (const key of model.omit ?? []) delete body[key];
  body = deepMerge(body, model.extra);

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-goog-api-key": apiKey,
    ...(provider.headers ?? {}),
  };

  const response = await fetchWithTimeout(
    url,
    { method: "POST", headers, body: JSON.stringify(body) },
    input.timeoutMs
  );
  const responseBody = await readBody(response);

  return {
    url,
    httpStatus: response.status,
    requestBody: redactBase64(body),
    requestHeaders: redactHeaders(headers),
    responseBody,
    rawText: extractText(responseBody),
    usage: extractUsage(responseBody),
  };
}

/**
 * Gemini responseSchema, OpenAPI 3.0 alt kumesini kullanir:
 * tipler BUYUK HARF, `additionalProperties` desteklenmez.
 * Alan sirasini sabitlemek icin propertyOrdering ekleniyor.
 */
export function toGeminiSchemaForTest(schema: Record<string, unknown>) {
  return toGeminiSchema(schema);
}

function toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema)) {
    if (key === "additionalProperties") continue;

    if (key === "type" && typeof value === "string") {
      out.type = value.toUpperCase();
    } else if (key === "properties" && isPlainObject(value)) {
      const props: Record<string, unknown> = {};
      for (const [propName, propSchema] of Object.entries(value)) {
        props[propName] = isPlainObject(propSchema) ? toGeminiSchema(propSchema) : propSchema;
      }
      out.properties = props;
      out.propertyOrdering = Object.keys(value);
    } else if (key === "items" && isPlainObject(value)) {
      out.items = toGeminiSchema(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function extractText(responseBody: unknown): string | null {
  if (!isPlainObject(responseBody) || !Array.isArray(responseBody.candidates)) return null;
  const candidate = responseBody.candidates[0];
  if (!isPlainObject(candidate) || !isPlainObject(candidate.content)) return null;
  const parts = candidate.content.parts;
  if (!Array.isArray(parts)) return null;

  const text = parts
    .filter(isPlainObject)
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("");
  return text.length > 0 ? text : null;
}

function extractUsage(responseBody: unknown) {
  const empty = { inputTokens: null, outputTokens: null, totalTokens: null, estimated: true };
  if (!isPlainObject(responseBody) || !isPlainObject(responseBody.usageMetadata)) return empty;

  const meta = responseBody.usageMetadata;
  const input = numberOrNull(meta.promptTokenCount);
  const candidates = numberOrNull(meta.candidatesTokenCount) ?? 0;
  // Gemini 2.5+ dusunme tokenlarini ayri raporlar; cikti fiyatiyla faturalanir.
  const thoughts = numberOrNull(meta.thoughtsTokenCount) ?? 0;
  const output = candidates + thoughts;

  if (input === null && output === 0) return empty;
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: numberOrNull(meta.totalTokenCount) ?? (input ?? 0) + output,
    estimated: false,
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
