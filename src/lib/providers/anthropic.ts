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
 * Anthropic Messages API (ham HTTP).
 *
 * Yapisal cikti icin `output_config.format` kullaniliyor (Claude Opus 5,
 * Sonnet 5, Haiku 4.5 destekliyor). Eski `output_format` parametresi kullanim
 * disi; tool-use ile semaya zorlamak da mumkun ama structured outputs daha net.
 *
 * Not: Opus 5'te dusunme (thinking) varsayilan olarak aciktir. Fis OCR gibi
 * kisa gorevlerde maliyeti kismak icin config'te output_config.effort = "low"
 * veriliyor (models.json -> extra). Haiku 4.5 effort parametresini kabul
 * etmedigi icin onda extra tanimlanmadi.
 */
export async function callAnthropic(
  model: ModelConfig,
  provider: ProviderConfig,
  apiKey: string,
  input: ExtractInput
): Promise<ProviderCallResult> {
  const url = `${provider.baseUrl.replace(/\/$/, "")}/messages`;

  let body: Record<string, unknown> = {
    model: model.model,
    max_tokens: input.maxTokens,
    system: input.systemPrompt,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: input.mediaType,
              data: input.imageBase64,
            },
          },
          {
            type: "text",
            text: "Bu fisi analiz et ve istenen JSON nesnesini dondur.",
          },
        ],
      },
    ],
  };

  if (model.structuredOutput === "json_schema") {
    body.output_config = {
      format: { type: "json_schema", schema: input.schema },
    };
  }

  for (const key of model.omit ?? []) delete body[key];
  body = deepMerge(body, model.extra);

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
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

/** content dizisindeki "text" bloklarini birlestirir (thinking bloklari atlanir). */
function extractText(responseBody: unknown): string | null {
  if (!isPlainObject(responseBody) || !Array.isArray(responseBody.content)) return null;
  const text = responseBody.content
    .filter(isPlainObject)
    .filter((block) => block.type === "text")
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .join("");
  return text.length > 0 ? text : null;
}

function extractUsage(responseBody: unknown) {
  const empty = { inputTokens: null, outputTokens: null, totalTokens: null, estimated: true };
  if (!isPlainObject(responseBody) || !isPlainObject(responseBody.usage)) return empty;

  const usage = responseBody.usage;
  const input = numberOrNull(usage.input_tokens);
  const output = numberOrNull(usage.output_tokens);
  if (input === null && output === null) return empty;

  // Onbellek tokenlari varsa girdiye ekle (fiyatlari farkli ama PoC icin yeterli yaklasim).
  const cacheRead = numberOrNull(usage.cache_read_input_tokens) ?? 0;
  const cacheWrite = numberOrNull(usage.cache_creation_input_tokens) ?? 0;
  const totalInput = (input ?? 0) + cacheRead + cacheWrite;

  return {
    inputTokens: totalInput,
    outputTokens: output,
    totalTokens: totalInput + (output ?? 0),
    estimated: false,
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
