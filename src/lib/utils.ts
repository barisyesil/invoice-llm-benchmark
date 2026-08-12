/** Duz nesneleri derinlemesine birlestirir. Diziler ve skalerler ustune yazilir. */
export function deepMerge<T extends Record<string, unknown>>(
  base: T,
  patch: Record<string, unknown> | undefined
): T {
  if (!patch) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = out[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      out[key] = deepMerge(current, value);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Debug panelinde gostermek uzere istek govdesini kopyalar ve icindeki
 * base64 gorsel verisini okunabilir bir ozetle degistirir.
 */
export function redactBase64(value: unknown, minLength = 256): unknown {
  if (typeof value === "string") {
    if (value.length < minLength) return value;
    const isDataUrl = value.startsWith("data:");
    const payload = isDataUrl ? value.slice(value.indexOf(",") + 1) : value;
    if (!looksBase64(payload)) return value;
    const kb = Math.round((payload.length * 0.75) / 1024);
    return `<base64 gorsel atlandi — ${payload.length.toLocaleString("tr-TR")} karakter, ~${kb} KB>`;
  }
  if (Array.isArray(value)) return value.map((v) => redactBase64(v, minLength));
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactBase64(v, minLength);
    return out;
  }
  return value;
}

function looksBase64(value: string): boolean {
  // Ilk 128 karakter base64 alfabesindeyse gorsel verisi kabul et.
  return /^[A-Za-z0-9+/=\s]{128}/.test(value);
}

/** Authorization / x-api-key gibi basliklari maskeler. */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const secretKeys = ["authorization", "x-api-key", "x-goog-api-key", "api-key"];
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = secretKeys.includes(k.toLowerCase()) ? maskSecret(v) : v;
  }
  return out;
}

function maskSecret(value: string): string {
  const bare = value.replace(/^Bearer\s+/i, "");
  const prefix = value.toLowerCase().startsWith("bearer ") ? "Bearer " : "";
  if (bare.length <= 10) return `${prefix}****`;
  return `${prefix}${bare.slice(0, 6)}...${bare.slice(-4)}`;
}

/** Bir kaynagi zaman asimi ile getirir. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Istek ${Math.round(timeoutMs / 1000)} sn icinde yanit vermedi (zaman asimi).`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Yanit govdesini JSON olarak okumaya calisir, olmazsa duz metin dondurur. */
export async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
