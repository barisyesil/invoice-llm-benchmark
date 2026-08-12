import type { GroundTruthEntry, ReceiptFieldName, ReceiptFields } from "./types";
import { FIELD_ORDER, SCORED_FIELDS, isScoredField } from "./schema";
import { foldTr } from "./normalize";

/** Bir alanin karsilastirma sonucu. */
export type FieldVerdict =
  | "dogru" // referansla eslesti
  | "yanlis" // referans var, model farkli bir deger yazdi
  | "eksik" // referans var, model bos birakti
  | "uydurma" // referansta alan YOK (null) ama model deger uretti
  | "bilgi" // puanlanmayan alan (aciklama) -> sadece raporda gosterilir
  | "atlandi"; // referansta alan yok ve model de bos birakti -> puanlamaya girmez

export interface FieldComparison {
  field: ReceiptFieldName;
  verdict: FieldVerdict;
  expected: string | null;
  actual: string;
}

export interface ComparisonResult {
  fields: FieldComparison[];
  /** Referansta degeri olan (puanlanabilir) alan sayisi */
  scored: number;
  correct: number;
  wrong: number;
  missing: number;
  /** Referansta olmayan alani model uydurdu mu (skora girmez, ayri raporlanir) */
  hallucinated: number;
  /** correct / scored — scored 0 ise null */
  accuracy: number | null;
}

/**
 * Model ciktisini referans (ground truth) ile karsilastirir.
 *
 * Karsilastirma bilincli olarak "hosgorulu": amac yazim farkini degil gercek
 * okuma hatasini olcmek. Sirket adinda unvan ekleri ve Turkce karakterler,
 * fatura numarasinda bostaki sifirlar, tutarda kurus yuvarlamasi tolere edilir.
 *
 * Referansta `null` olan alanlar (belgede gercekten yok) dogruluk skoruna
 * GIRMEZ; model yine de bir deger uretirse "uydurma" olarak ayrica raporlanir.
 *
 * `aciklama` gibi UNSCORED_FIELDS alanlari hicbir metrige girmez: modelin
 * belgeyi anlamlandirip kisa bir ozet yazmasi yeterlidir, birebir eslesme
 * beklenmez. Bu alanlar "bilgi" damgasiyla sadece raporda gosterilir.
 */
export function compareToGroundTruth(
  actual: ReceiptFields | null,
  expected: GroundTruthEntry
): ComparisonResult {
  const fields: FieldComparison[] = FIELD_ORDER.map((field) => {
    const expectedValue = expected[field];
    const actualValue = actual ? actual[field] : "";
    const actualText = toText(actualValue);
    const actualEmpty = isEmptyValue(actualValue);

    // Puanlanmayan alan -> ne dogru/yanlis ne de uydurma sayilir
    if (!isScoredField(field)) {
      return {
        field,
        verdict: "bilgi" as const,
        expected: expectedValue === null || expectedValue === undefined ? null : toText(expectedValue),
        actual: actualText,
      };
    }

    // Referansta alan yok -> puanlama disi, sadece uydurma kontrolu
    if (expectedValue === null || expectedValue === undefined) {
      return {
        field,
        verdict: actualEmpty ? ("atlandi" as const) : ("uydurma" as const),
        expected: null,
        actual: actualText,
      };
    }

    const expectedText = toText(expectedValue);

    if (actualEmpty) {
      return { field, verdict: "eksik" as const, expected: expectedText, actual: "" };
    }

    const alternatives = expected.alternatifler?.[field] ?? [];
    const match = matchField(field, actualValue, expectedValue, alternatives);

    return {
      field,
      verdict: match ? ("dogru" as const) : ("yanlis" as const),
      expected: expectedText,
      actual: actualText,
    };
  });

  const correct = fields.filter((f) => f.verdict === "dogru").length;
  const wrong = fields.filter((f) => f.verdict === "yanlis").length;
  const missing = fields.filter((f) => f.verdict === "eksik").length;
  const hallucinated = fields.filter((f) => f.verdict === "uydurma").length;
  const scored = correct + wrong + missing;

  return {
    fields,
    scored,
    correct,
    wrong,
    missing,
    hallucinated,
    accuracy: scored > 0 ? correct / scored : null,
  };
}

function matchField(
  field: ReceiptFieldName,
  actual: string | number,
  expected: string | number,
  alternatives: string[]
): boolean {
  if (field === "toplam_tutar") {
    const a = typeof actual === "number" ? actual : Number.parseFloat(String(actual));
    const e = typeof expected === "number" ? expected : Number.parseFloat(String(expected));
    if (!Number.isFinite(a) || !Number.isFinite(e)) return false;
    return Math.abs(a - e) < 0.005;
  }

  const candidates = [String(expected), ...alternatives];

  switch (field) {
    case "tarih":
      return candidates.some((c) => String(actual).trim() === c.trim());

    case "fatura_no":
      return candidates.some((c) => normalizeDocId(String(actual)) === normalizeDocId(c));

    case "tur":
      return candidates.some((c) => foldTr(String(actual)) === foldTr(c));

    case "sirket_adi":
      return candidates.some((c) => companyMatches(String(actual), c));

    default:
      // aciklama buraya hic gelmez (puanlanmayan alan), diger serbest metinler icin
      // sadelestirilmis icerme kontrolu yeterli.
      return candidates.some((c) => textMatches(String(actual), c));
  }
}

/** Bostaki sifirlar, bosluk ve buyuk/kucuk harf farkini yok sayar. */
function normalizeDocId(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "").replace(/^0+/, "");
}

/**
 * Sirket adi eslestirmesi: unvan ekleri (A.S., LTD. STI. ...) ve Turkce
 * karakterler sadelestirilir; taraflardan biri digerini iceriyorsa dogru sayilir.
 * Ornek: "METRO GROSMARKET" ~ "METRO GROSMARKET-ESKISEHIR-STANDART"
 */
function companyMatches(actual: string, expected: string): boolean {
  const a = stripLegalSuffix(foldTr(actual));
  const e = stripLegalSuffix(foldTr(expected));
  if (a.length === 0 || e.length === 0) return false;
  if (a === e) return true;
  return a.includes(e) || e.includes(a);
}

function stripLegalSuffix(value: string): string {
  return value
    .replace(
      /\b(a s|as|ltd|sti|limited|sirketi|san|tic|ve|anonim|kollektif|koll)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** Serbest metin: sadelestirip icerme kontrolu. */
function textMatches(actual: string, expected: string): boolean {
  const a = foldTr(actual);
  const e = foldTr(expected);
  if (a.length === 0 || e.length === 0) return false;
  return a === e || a.includes(e) || e.includes(a);
}

function toText(value: string | number | null): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  return value;
}

function isEmptyValue(value: string | number): boolean {
  if (typeof value === "number") return value === 0;
  return value.trim() === "";
}

/** Tekli test ekranindaki elle girilen referansi GroundTruthEntry'ye cevirir. */
export function fieldsToGroundTruth(fields: ReceiptFields): GroundTruthEntry {
  return {
    tarih: fields.tarih.trim() === "" ? null : fields.tarih.trim(),
    fatura_no: fields.fatura_no.trim() === "" ? null : fields.fatura_no.trim(),
    sirket_adi: fields.sirket_adi.trim() === "" ? null : fields.sirket_adi.trim(),
    toplam_tutar: fields.toplam_tutar === 0 ? null : fields.toplam_tutar,
    tur: fields.tur.trim() === "" ? null : fields.tur.trim(),
    aciklama: fields.aciklama.trim() === "" ? null : fields.aciklama.trim(),
  };
}

export function isGroundTruthSet(entry: GroundTruthEntry | null): entry is GroundTruthEntry {
  if (!entry) return false;
  // Sadece aciklama girilmis bir referans puanlanamaz — puanlanan alanlara bakilir.
  return SCORED_FIELDS.some((field) => entry[field] !== null && entry[field] !== undefined);
}

export const VERDICT_LABELS: Record<FieldVerdict, string> = {
  dogru: "Doğru",
  yanlis: "Yanlış",
  eksik: "Eksik",
  uydurma: "Uydurma",
  bilgi: "Bilgi (puanlanmaz)",
  atlandi: "—",
};
