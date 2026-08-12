import { NextResponse } from "next/server";
import { getApiKey, getModel, getProvider, loadConfig } from "@/lib/config";
import { getAdapter } from "@/lib/providers";
import { RECEIPT_SCHEMA } from "@/lib/schema";
import { normalizeReceipt } from "@/lib/normalize";
import { computeCost, estimateImageTokens, estimateTextTokens } from "@/lib/cost";
import { readTestSetImageBase64 } from "@/lib/testset";
import type { ExtractResponse, TokenUsage } from "@/lib/types";
import { isPlainObject } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface ExtractRequest {
  modelId: string;
  /** Kullanicinin yukledigi gorsel (tekli test / kendi dosyalarinla batch) */
  imageBase64?: string;
  mediaType?: string;
  /** Test setindeki bir gorsel — sunucu dosyayi kendisi okur, tarayiciya yuk binmez */
  testSetFile?: string;
}

export async function POST(request: Request) {
  let payload: ExtractRequest;
  try {
    payload = (await request.json()) as ExtractRequest;
  } catch {
    return NextResponse.json({ error: "Gecersiz JSON govdesi." }, { status: 400 });
  }

  const { modelId, testSetFile } = payload;
  if (!modelId) {
    return NextResponse.json({ error: "'modelId' zorunlu." }, { status: 400 });
  }

  // --- Gorsel kaynagini coz ------------------------------------------------
  let imageBase64: string;
  let mediaType: string;

  if (testSetFile) {
    const image = readTestSetImageBase64(testSetFile);
    if (!image) {
      return NextResponse.json(
        { error: `Test setinde bulunamadi: "${testSetFile}"` },
        { status: 400 }
      );
    }
    imageBase64 = image.base64;
    mediaType = image.mediaType;
  } else if (payload.imageBase64 && payload.mediaType) {
    imageBase64 = payload.imageBase64;
    mediaType = payload.mediaType;
  } else {
    return NextResponse.json(
      { error: "'testSetFile' veya ('imageBase64' + 'mediaType') gerekli." },
      { status: 400 }
    );
  }

  const { config, prompt } = loadConfig();

  // --- Model / saglayici / anahtar cozumleme -------------------------------
  let model, provider, apiKey: string | null;
  try {
    model = getModel(config, modelId);
    provider = getProvider(config, model);
    apiKey = getApiKey(provider);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  if (!apiKey) {
    return NextResponse.json(
      {
        error: `${provider.label} icin API anahtari yok. .env.local dosyasina ${provider.apiKeyEnv} ekleyin.`,
      },
      { status: 400 }
    );
  }

  const input = {
    imageBase64,
    mediaType,
    systemPrompt: prompt,
    schema: RECEIPT_SCHEMA,
    maxTokens: model.maxTokens ?? config.defaults.maxTokens,
    timeoutMs: config.defaults.timeoutMs,
  };

  // --- Cagri + yeniden deneme + sure olcumu --------------------------------
  //
  // Saglayicilar (ozellikle Gemini) yogun saatlerde 503/429 dondurebiliyor.
  // Tek fis testinde bu can sikici, TOPLU testte raporu bozar — bu yuzden
  // gecici hatalarda ustel bekleme ile yeniden deneniyor. Olculen sure
  // SONUCU URETEN denemenin suresidir; kac deneme yapildigi debug'a yazilir.
  const adapter = getAdapter(provider.kind);
  const retry = config.defaults.retry ?? {
    maxAttempts: 1,
    baseDelayMs: 1000,
    retryOnStatus: [] as number[],
  };

  let call;
  let latencyMs = 0;
  let attempts = 0;
  const retriedOn: string[] = [];

  for (;;) {
    attempts += 1;
    const startedAt = performance.now();

    try {
      call = await adapter(model, provider, apiKey, input);
      latencyMs = Math.round(performance.now() - startedAt);

      const transient =
        retry.retryOnStatus.includes(call.httpStatus) && !isPermanentQuotaError(call.responseBody);
      if (!transient || attempts >= retry.maxAttempts) break;
      retriedOn.push(`HTTP ${call.httpStatus}`);
    } catch (err) {
      latencyMs = Math.round(performance.now() - startedAt);
      const message = (err as Error).message;

      if (attempts >= retry.maxAttempts) {
        return NextResponse.json(
          buildFailure(model.id, model.label, provider.label, latencyMs, message, {
            url: `${provider.baseUrl} (${provider.kind})`,
            imageBytes: base64Bytes(imageBase64),
            currency: config.defaults.currency,
            attempts,
            retriedOn,
          }),
          { status: 200 } // Hatayi 200 ile dondururuz: arayuz raporda gostersin.
        );
      }
      retriedOn.push(message.slice(0, 80));
    }

    await sleep(retry.baseDelayMs * 2 ** (attempts - 1));
  }

  const httpOk = call.httpStatus >= 200 && call.httpStatus < 300;

  // --- Kullanim / maliyet --------------------------------------------------
  const usage: TokenUsage = call.usage.estimated
    ? {
        inputTokens:
          estimateImageTokens(imageBase64.length) + estimateTextTokens(input.systemPrompt),
        outputTokens: call.rawText ? estimateTextTokens(call.rawText) : 0,
        totalTokens: null,
        estimated: true,
      }
    : call.usage;
  if (usage.totalTokens === null) {
    usage.totalTokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  }
  const cost = computeCost(model, usage, config.defaults.currency);

  // --- Ayristirma ----------------------------------------------------------
  const { parsed, warnings } = httpOk
    ? normalizeReceipt(call.rawText)
    : { parsed: null, warnings: [] as string[] };

  const error = httpOk
    ? parsed === null
      ? "Model yaniti fatura verisine cevrilemedi."
      : null
    : extractApiError(call.responseBody, call.httpStatus);

  const result: ExtractResponse = {
    modelId: model.id,
    modelLabel: model.label,
    providerLabel: provider.label,
    ok: httpOk && parsed !== null,
    latencyMs,
    parsed,
    warnings,
    error,
    usage,
    cost,
    debug: {
      url: call.url,
      httpStatus: call.httpStatus,
      requestHeaders: call.requestHeaders,
      requestBody: call.requestBody,
      responseBody: call.responseBody,
      rawText: call.rawText,
      imageBytes: base64Bytes(imageBase64),
      attempts,
      retriedOn,
    },
  };

  return NextResponse.json(result);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 429'un iki farkli anlami var: "cok hizli gonderdin" (gecici, beklenmeli) ve
 * "kotan/bakiyen bitti" (kalici, beklemek ise yaramaz). Ikincisinde yeniden
 * denemek toplu testte onlarca bosuna cagri ve dakikalarca gecikme demek.
 */
function isPermanentQuotaError(body: unknown): boolean {
  const text = (typeof body === "string" ? body : JSON.stringify(body ?? "")).toLowerCase();
  return (
    text.includes("exceeded your current quota") ||
    text.includes("billing") ||
    text.includes("insufficient_quota") ||
    text.includes("credit balance is too low")
  );
}

function base64Bytes(base64: string): number {
  return Math.round(base64.length * 0.75);
}

/** Saglayicilarin farkli hata govdelerinden okunabilir bir mesaj cikarir. */
function extractApiError(body: unknown, status: number): string {
  if (typeof body === "string" && body.trim().length > 0) {
    return `HTTP ${status}: ${body.slice(0, 400)}`;
  }
  if (isPlainObject(body)) {
    const err = body.error;
    if (typeof err === "string") return `HTTP ${status}: ${err}`;
    if (isPlainObject(err) && typeof err.message === "string") {
      return `HTTP ${status}: ${err.message}`;
    }
    if (typeof body.message === "string") return `HTTP ${status}: ${body.message}`;
  }
  return `HTTP ${status}: Saglayici hata dondurdu (detay icin ham yaniti acin).`;
}

function buildFailure(
  modelId: string,
  modelLabel: string,
  providerLabel: string,
  latencyMs: number,
  message: string,
  meta: {
    url: string;
    imageBytes: number;
    currency: string;
    attempts: number;
    retriedOn: string[];
  }
): ExtractResponse {
  return {
    modelId,
    modelLabel,
    providerLabel,
    ok: false,
    latencyMs,
    parsed: null,
    warnings: [],
    error: message,
    usage: { inputTokens: null, outputTokens: null, totalTokens: null, estimated: true },
    cost: {
      inputCost: 0,
      outputCost: 0,
      totalCost: 0,
      currency: meta.currency,
      estimated: true,
    },
    debug: {
      url: meta.url,
      httpStatus: 0,
      requestHeaders: {},
      requestBody: null,
      responseBody: { error: message },
      rawText: null,
      imageBytes: meta.imageBytes,
      attempts: meta.attempts,
      retriedOn: meta.retriedOn,
    },
  };
}
