import type { ReceiptFields } from "./types";
import { BELGE_TURLERI } from "./schema";
import { isPlainObject } from "./utils";

export interface NormalizeResult {
  parsed: ReceiptFields | null;
  warnings: string[];
}

export const EMPTY_FIELDS: ReceiptFields = {
  tarih: "",
  fatura_no: "",
  sirket_adi: "",
  toplam_tutar: 0,
  tur: "",
  aciklama: "",
};

/**
 * Modelin urettigi ham metni ReceiptFields'a cevirir.
 *
 * Yapisal cikti desteklemeyen modeller (json_object / none) markdown kod blogu,
 * aciklama metni veya Turkce sayi formati dondurebiliyor; burada hepsi toparlaniyor.
 * Yapilan her duzeltme "warnings" olarak arayuzde gosteriliyor — yani modelin ham
 * ciktisinin ne kadar "temiz" oldugu da bir karsilastirma metrigi haline geliyor.
 */
export function normalizeReceipt(rawText: string | null): NormalizeResult {
  const warnings: string[] = [];

  if (!rawText || rawText.trim().length === 0) {
    return { parsed: null, warnings: ["Model bos yanit dondurdu."] };
  }

  const jsonText = extractJson(rawText, warnings);
  if (jsonText === null) {
    return { parsed: null, warnings: [...warnings, "Yanit icinde JSON nesnesi bulunamadi."] };
  }

  let obj: unknown;
  try {
    obj = JSON.parse(jsonText);
  } catch (err) {
    return {
      parsed: null,
      warnings: [...warnings, `JSON ayristirilamadi: ${(err as Error).message}`],
    };
  }

  if (!isPlainObject(obj)) {
    return { parsed: null, warnings: [...warnings, "Yanit bir JSON nesnesi degil."] };
  }

  // Bazi modeller sonucu {"fatura": {...}} / {"data": {...}} gibi sarabiliyor.
  let source = obj;
  if (!("toplam_tutar" in source) && !("tarih" in source)) {
    const wrapped = Object.values(source).find(
      (v) => isPlainObject(v) && ("toplam_tutar" in v || "tarih" in v)
    );
    if (isPlainObject(wrapped)) {
      warnings.push("Alanlar ic ice bir nesnede bulundu, disari cikarildi.");
      source = wrapped;
    }
  }

  return {
    parsed: {
      tarih: normalizeDate(source.tarih, warnings),
      fatura_no: normalizeDocNo(source.fatura_no, warnings),
      sirket_adi: normalizeText(source.sirket_adi, "sirket_adi", warnings),
      toplam_tutar: normalizeAmount(source.toplam_tutar, warnings),
      tur: normalizeTur(source.tur, warnings),
      aciklama: normalizeText(source.aciklama, "aciklama", warnings),
    },
    warnings,
  };
}

/** Markdown kod bloklarini ve etraftaki aciklama metnini temizler. */
function extractJson(text: string, warnings: string[]): string | null {
  const trimmed = text.trim();

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    warnings.push("Yanit markdown kod blogu icindeydi, temizlendi.");
    return fenced[1].trim();
  }

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    warnings.push("Yanitta JSON disinda metin vardi, JSON kismi ayiklandi.");
    return trimmed.slice(start, end + 1);
  }
  return null;
}

const MONTHS_TR: Record<string, string> = {
  ocak: "01", şubat: "02", subat: "02", mart: "03", nisan: "04",
  mayıs: "05", mayis: "05", haziran: "06", temmuz: "07", ağustos: "08",
  agustos: "08", eylül: "09", eylul: "09", ekim: "10", kasım: "11",
  kasim: "11", aralık: "12", aralik: "12",
};

/** Cesitli tarih yazimlarini YYYY-MM-DD'ye cevirir. */
export function normalizeDate(value: unknown, warnings: string[]): string {
  if (value === null || value === undefined) {
    warnings.push("'tarih' alani yanitta yok.");
    return "";
  }
  const text = String(value).trim();
  if (text === "" || text.toLowerCase() === "null") return "";

  // Zaten dogru format
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  // GG/AA/YYYY, GG.AA.YYYY, GG-AA-YYYY, GG/AA/YY  (tek haneli gun/ay dahil)
  const dmy = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const year = y.length === 2 ? `20${y}` : y;
    warnings.push(`'tarih' "${text}" -> ISO formatina cevrildi.`);
    return `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // "5 Eylül 2025"
  const textual = text.match(/^(\d{1,2})\s+([A-Za-zÇĞİÖŞÜçğıöşü]+)\s+(\d{4})/);
  if (textual) {
    const month = MONTHS_TR[textual[2].toLowerCase()];
    if (month) {
      warnings.push(`'tarih' "${text}" -> ISO formatina cevrildi.`);
      return `${textual[3]}-${month}-${textual[1].padStart(2, "0")}`;
    }
  }

  // YYYY/AA/GG
  const ymd = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (ymd) {
    warnings.push(`'tarih' "${text}" -> ISO formatina cevrildi.`);
    return `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}`;
  }

  warnings.push(`'tarih' formati taninmadi, ham deger korundu: "${text}"`);
  return text;
}

/** Fatura/fis numarasindan etiket ve gereksiz isaretleri temizler. */
export function normalizeDocNo(value: unknown, warnings: string[]): string {
  if (value === null || value === undefined) {
    warnings.push("'fatura_no' alani yanitta yok.");
    return "";
  }
  const text = String(value).trim();
  if (text.toLowerCase() === "null" || text === "-") return "";

  const labelled = text.match(
    /^(?:fatura\s*(?:no|numarası|numarasi)|belge\s*no|fi[sş]\s*no|no)\s*[:.]?\s*(.+)$/i
  );
  if (labelled) {
    warnings.push("'fatura_no' icindeki etiket temizlendi.");
    return labelled[1].trim();
  }
  return text;
}

/** Serbest metin alanlari: bosluk temizligi + "null"/"yok" gibi degerleri bosa cevirme. */
export function normalizeText(
  value: unknown,
  field: string,
  warnings: string[]
): string {
  if (value === null || value === undefined) {
    warnings.push(`'${field}' alani yanitta yok.`);
    return "";
  }
  const text = String(value).replace(/\s+/g, " ").trim();
  if (["null", "yok", "belirtilmemiş", "belirtilmemis", "n/a", "-"].includes(text.toLowerCase())) {
    return "";
  }
  return text;
}

/** Tur degerini sabit sozluge oturtur. */
export function normalizeTur(value: unknown, warnings: string[]): string {
  if (value === null || value === undefined) {
    warnings.push("'tur' alani yanitta yok.");
    return "";
  }
  const text = String(value).trim();
  if (text === "") return "";

  const exact = BELGE_TURLERI.find((t) => t === text);
  if (exact) return exact;

  const loose = BELGE_TURLERI.find((t) => foldTr(t) === foldTr(text));
  if (loose) {
    warnings.push(`'tur' "${text}" -> "${loose}" olarak eslendi.`);
    return loose;
  }

  warnings.push(`'tur' sozlukte yok, ham deger korundu: "${text}"`);
  return text;
}

/** "1.234,56", "1,234.56", "₺1.234,56 TL" gibi yazimlari sayiya cevirir. */
export function normalizeAmount(value: unknown, warnings: string[]): number {
  if (value === null || value === undefined) {
    warnings.push("'toplam_tutar' alani yanitta yok.");
    return 0;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const text = String(value).trim();
  if (text === "") return 0;

  const cleaned = text.replace(/[^\d.,-]/g, "");
  if (cleaned === "") {
    warnings.push(`'toplam_tutar' sayiya cevrilemedi: "${text}"`);
    return 0;
  }

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  const commaCount = (cleaned.match(/,/g) ?? []).length;
  const dotCount = (cleaned.match(/\./g) ?? []).length;
  let normalized: string;

  if (commaCount > 1 && dotCount === 0) {
    // "45,750,000" — birden fazla virgul ondalik olamaz, hepsi binlik ayiricidir.
    normalized = cleaned.replace(/,/g, "");
  } else if (dotCount > 1 && commaCount === 0) {
    // "1.520.813" — ayni sekilde hepsi binlik.
    normalized = cleaned.replace(/\./g, "");
  } else if (lastComma > lastDot) {
    // Turkce yazim: nokta binlik, virgul ondalik -> 1.234,56
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma) {
    // Ingilizce yazim: virgul binlik, nokta ondalik -> 1,234.56
    normalized = cleaned.replace(/,/g, "");
  } else {
    normalized = cleaned;
  }

  const num = Number.parseFloat(normalized);
  if (!Number.isFinite(num)) {
    warnings.push(`'toplam_tutar' sayiya cevrilemedi: "${text}"`);
    return 0;
  }
  if (typeof value !== "number") {
    warnings.push(`'toplam_tutar' metin olarak geldi ("${text}"), sayiya cevrildi.`);
  }
  return num;
}

/** Turkce karakterleri ve noktalamayi sadelestirip karsilastirilabilir hale getirir. */
export function foldTr(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .replaceAll("ı", "i")
    .replaceAll("ğ", "g")
    .replaceAll("ü", "u")
    .replaceAll("ş", "s")
    .replaceAll("ö", "o")
    .replaceAll("ç", "c")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
