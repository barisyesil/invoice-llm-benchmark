import type {
  ExtractInput,
  ModelConfig,
  ProviderCallResult,
  ProviderConfig,
} from "../types";
import { SCHEMA_NAME } from "../schema";
import { deepMerge, fetchWithTimeout, readBody, redactBase64, redactHeaders } from "../utils";
import { isPlainObject } from "../utils";

/**
 * OpenAI Chat Completions uyumlu tum saglayicilar:
 * OpenAI, Groq, OpenRouter, xAI, Together, Fireworks, Ollama, vLLM, LM Studio...
 * Tek fark baseUrl + apiKeyEnv oldugu icin hepsi bu tek adaptorden geciyor.
 */
export async function callOpenAiCompatible(
  model: ModelConfig,
  provider: ProviderConfig,
  apiKey: string,
  input: ExtractInput
): Promise<ProviderCallResult> {
  const url = `${provider.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const tokenParam = model.tokenParam ?? "max_tokens";

  let body: Record<string, unknown> = {
    model: model.model,
    temperature: 0,
    [tokenParam]: input.maxTokens,
    messages: [
      { role: "system", content: input.systemPrompt },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Bu fisi analiz et ve istenen JSON nesnesini dondur.",
          },
          {
            type: "image_url",
            image_url: {
              url: `data:${input.mediaType};base64,${input.imageBase64}`,
              detail: "high",
            },
          },
        ],
      },
    ],
  };

  if (model.structuredOutput === "json_schema") {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: SCHEMA_NAME, strict: true, schema: input.schema },
    };
  } else if (model.structuredOutput === "json_object") {
    body.response_format = { type: "json_object" };
  }

  for (const key of model.omit ?? []) delete body[key];
  body = deepMerge(body, model.extra);

  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
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

function extractText(responseBody: unknown): string | null {
  if (!isPlainObject(responseBody)) return null;
  const choices = responseBody.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = isPlainObject(choices[0]) ? choices[0].message : null;
  if (!isPlainObject(message)) return null;

  if (typeof message.content === "string") return message.content;

  // Bazi saglayicilar content'i blok dizisi olarak donduruyor.
  if (Array.isArray(message.content)) {
    const text = message.content
      .filter(isPlainObject)
      .map((block) => (typeof block.text === "string" ? block.text : ""))
      .join("");
    return text.length > 0 ? text : null;
  }
  return null;
}

function extractUsage(responseBody: unknown) {
  const empty = { inputTokens: null, outputTokens: null, totalTokens: null, estimated: true };
  if (!isPlainObject(responseBody) || !isPlainObject(responseBody.usage)) return empty;

  const usage = responseBody.usage;
  const input = numberOrNull(usage.prompt_tokens ?? usage.input_tokens);
  const output = numberOrNull(usage.completion_tokens ?? usage.output_tokens);
  const total = numberOrNull(usage.total_tokens) ?? sum(input, output);

  if (input === null && output === null) return empty;
  return { inputTokens: input, outputTokens: output, totalTokens: total, estimated: false };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sum(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}
