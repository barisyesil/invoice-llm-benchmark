import fs from "node:fs";
import path from "node:path";
import type { GroundTruthEntry, TestSetItem } from "./types";

const PROJECT_ROOT = findProjectRoot();
const TESTSET_DIR = path.join(PROJECT_ROOT, "testset");
const IMAGES_DIR = path.join(TESTSET_DIR, "images");
const GROUND_TRUTH_FILE = path.join(TESTSET_DIR, "ground-truth.json");

const MEDIA_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/**
 * Proje kokunu bulur (config/ klasorunu barindiran dizin).
 * Sunucu farkli bir calisma dizininden baslatilsa bile calisir.
 */
function findProjectRoot(): string {
  const override = process.env.INVOICE_LAB_CONFIG_DIR;
  if (override) return path.dirname(path.resolve(override));

  let dir = process.cwd();
  for (let i = 0; i < 5; i += 1) {
    if (fs.existsSync(path.join(dir, "config", "models.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

interface GroundTruthFile {
  items: Record<string, GroundTruthEntry>;
}

let cached: { items: TestSetItem[]; mtime: number } | null = null;

function readGroundTruth(): Record<string, GroundTruthEntry> {
  if (!fs.existsSync(GROUND_TRUTH_FILE)) return {};
  // BOM temizligi: Windows editorleri UTF-8 dosyalarin basina BOM ekleyebiliyor.
  const raw = fs.readFileSync(GROUND_TRUTH_FILE, "utf8").replace(/^﻿/, "");
  try {
    return (JSON.parse(raw) as GroundTruthFile).items ?? {};
  } catch (err) {
    throw new Error(`ground-truth.json gecerli JSON degil: ${(err as Error).message}`);
  }
}

/**
 * testset/images/ altindaki gorselleri listeler ve her birini dosya adiyla
 * ground-truth.json kaydina eslestirir.
 *
 * Yeni ornek eklemek: gorseli klasore koy + ground-truth.json'a ayni dosya adiyla
 * kayit ekle. Referansi olmayan gorseller de listelenir (hasGroundTruth: false),
 * sadece puanlanmaz.
 */
export function listTestSet(): TestSetItem[] {
  if (!fs.existsSync(IMAGES_DIR)) return [];

  const gtStat = fs.existsSync(GROUND_TRUTH_FILE) ? fs.statSync(GROUND_TRUTH_FILE).mtimeMs : 0;
  const dirStat = fs.statSync(IMAGES_DIR).mtimeMs;
  const mtime = Math.max(gtStat, dirStat);

  if (cached && cached.mtime === mtime) return cached.items;

  const groundTruth = readGroundTruth();

  const items = fs
    .readdirSync(IMAGES_DIR)
    .filter((name) => MEDIA_TYPES[path.extname(name).toLowerCase()] !== undefined)
    .sort((a, b) => a.localeCompare(b, "tr"))
    .map<TestSetItem>((fileName) => {
      const entry = groundTruth[fileName] ?? null;
      return {
        fileName,
        kategori: entry?.kategori ?? "diger",
        not: entry?.not,
        hasGroundTruth: entry !== null,
        groundTruth: entry,
        sizeBytes: fs.statSync(path.join(IMAGES_DIR, fileName)).size,
      };
    });

  cached = { items, mtime };
  return items;
}

/** Dosya adini guvenli sekilde cozer — dizin gezinme (path traversal) engellenir. */
export function resolveTestSetImage(
  fileName: string
): { fullPath: string; mediaType: string } | null {
  const safeName = path.basename(fileName);
  if (safeName !== fileName || safeName.startsWith(".")) return null;

  const mediaType = MEDIA_TYPES[path.extname(safeName).toLowerCase()];
  if (!mediaType) return null;

  const fullPath = path.join(IMAGES_DIR, safeName);
  if (!fullPath.startsWith(IMAGES_DIR)) return null;
  if (!fs.existsSync(fullPath)) return null;

  return { fullPath, mediaType };
}

/** Test seti gorselini base64 olarak okur (sunucu tarafi — tarayiciya yuk binmez). */
export function readTestSetImageBase64(
  fileName: string
): { base64: string; mediaType: string } | null {
  const resolved = resolveTestSetImage(fileName);
  if (!resolved) return null;
  return {
    base64: fs.readFileSync(resolved.fullPath).toString("base64"),
    mediaType: resolved.mediaType,
  };
}

/** Dosya adina gore referans kaydini dondurur (kullanicinin kendi yukledigi dosyalar icin de). */
export function getGroundTruthFor(fileName: string): GroundTruthEntry | null {
  return readGroundTruth()[path.basename(fileName)] ?? null;
}
