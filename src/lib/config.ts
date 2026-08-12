import fs from "node:fs";
import path from "node:path";
import type { AppConfig, ModelConfig, ProviderConfig } from "./types";

/**
 * Konfigurasyon klasorunu bulur.
 *
 * Normal kullanimda (proje kokunden `npm run dev` / `npm start`) bu basitce
 * <proje>/config olur. Sunucu baska bir calisma dizininden baslatildiysa
 * (bazi IDE/onizleme baslaticilari boyle yapar) ust klasorlere dogru aranir.
 * INVOICE_LAB_CONFIG_DIR ile elle de gosterilebilir.
 */
function resolveConfigDir(): string {
  const override = process.env.INVOICE_LAB_CONFIG_DIR;
  if (override) return path.resolve(override);

  const candidates: string[] = [];
  let dir = process.cwd();
  for (let i = 0; i < 5; i += 1) {
    candidates.push(path.join(dir, "config"));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const found = candidates.find((candidate) =>
    fs.existsSync(path.join(candidate, "models.json"))
  );
  if (found) return found;

  throw new Error(
    `config/models.json bulunamadi. Sunucuyu proje kokunden calistirin ` +
      `(cd invoice-llm-benchmark && npm run dev) veya INVOICE_LAB_CONFIG_DIR ortam ` +
      `degiskenini ayarlayin. Aranan yerler: ${candidates.join(", ")}`
  );
}

const CONFIG_DIR = resolveConfigDir();

let cached: { config: AppConfig; prompt: string; mtime: number } | null = null;

/**
 * BOM'u temizler. Windows'ta bazi editorler / PowerShell UTF-8 dosyalarin basina
 * BOM ekler ve JSON.parse bunu "Unexpected token" diye reddeder.
 */
function readJsonFile(file: string): unknown {
  const raw = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${path.basename(file)} gecerli JSON degil: ${(err as Error).message}`);
  }
}

function readConfigFile(): AppConfig {
  const file = path.join(CONFIG_DIR, "models.json");
  const parsed = readJsonFile(file) as AppConfig;

  if (!parsed.providers || !parsed.models) {
    throw new Error("config/models.json: 'providers' ve 'models' alanlari zorunlu.");
  }
  for (const m of parsed.models) {
    if (!parsed.providers[m.provider]) {
      throw new Error(
        `config/models.json: "${m.id}" modeli tanimsiz saglayiciya isaret ediyor: "${m.provider}"`
      );
    }
  }
  return parsed;
}

function readPromptFile(): string {
  return fs
    .readFileSync(path.join(CONFIG_DIR, "prompt.txt"), "utf8")
    .replace(/^﻿/, "")
    .trim();
}

/**
 * Konfigurasyonu yukler. Gelistirme modunda dosya her degistiginde yeniden okunur,
 * boylece models.json'a model eklerken sunucuyu yeniden baslatmak gerekmez.
 */
export function loadConfig(): { config: AppConfig; prompt: string } {
  const stat = fs.statSync(path.join(CONFIG_DIR, "models.json"));
  const promptStat = fs.statSync(path.join(CONFIG_DIR, "prompt.txt"));
  const mtime = Math.max(stat.mtimeMs, promptStat.mtimeMs);

  if (!cached || cached.mtime !== mtime) {
    cached = { config: readConfigFile(), prompt: readPromptFile(), mtime };
  }
  return { config: cached.config, prompt: cached.prompt };
}

export function getModel(config: AppConfig, modelId: string): ModelConfig {
  const model = config.models.find((m) => m.id === modelId);
  if (!model) throw new Error(`Bilinmeyen model id: "${modelId}"`);
  if (!model.enabled) throw new Error(`"${model.label}" konfigurasyonda pasif (enabled: false).`);
  return model;
}

export function getProvider(config: AppConfig, model: ModelConfig): ProviderConfig {
  return config.providers[model.provider];
}

/** Anahtar sadece sunucu tarafinda okunur, hicbir zaman istemciye gonderilmez. */
export function getApiKey(provider: ProviderConfig): string | null {
  const value = process.env[provider.apiKeyEnv];
  return value && value.trim().length > 0 ? value.trim() : null;
}
