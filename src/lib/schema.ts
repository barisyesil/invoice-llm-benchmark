/**
 * Tum saglayicilarda calisan ortak JSON semasi.
 *
 * Bilincli olarak "nullable" alan KULLANILMIYOR: OpenAI strict mode, Anthropic
 * structured outputs ve Gemini responseSchema'nin ortak paydasinda kalmak icin
 * tum alanlar zorunlu ve tekil tipte. Model okuyamadigi/olmayan alan icin
 * bos metin ("") veya 0 yazar — prompt.txt bunu soyluyor.
 */

/** Belge turu icin sabit sozluk. Sabit olmasi karsilastirmayi anlamli kilar. */
export const BELGE_TURLERI = [
  "Market Fişi",
  "E-Arşiv Fatura",
  "e-Fatura",
  "Abonelik Faturası",
  "Fatura",
  "Proforma Fatura",
  "Teklif",
  "POS Slip",
  "İrsaliye",
  "Serbest Meslek Makbuzu",
  "Gider Pusulası",
  "Diğer",
] as const;

export type BelgeTuru = (typeof BELGE_TURLERI)[number];

export const RECEIPT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    tarih: {
      type: "string",
      description:
        "Belgenin duzenlenme tarihi, YYYY-MM-DD formatinda. Belgede yoksa bos metin.",
    },
    fatura_no: {
      type: "string",
      description:
        "Fatura / belge / fis numarasi. Belgede yoksa bos metin. Asla uydurma.",
    },
    sirket_adi: {
      type: "string",
      description:
        "Belgeyi duzenleyen (satici) firma veya kisi adi. Alici degil.",
    },
    toplam_tutar: {
      type: "number",
      description:
        "Odenecek genel toplam, nokta ondalik ayirici ile. Okunamazsa 0.",
    },
    tur: {
      type: "string",
      enum: [...BELGE_TURLERI],
      description: "Belge turu. Listedeki degerlerden tam olarak biri.",
    },
    aciklama: {
      type: "string",
      description:
        "Belgenin ne icin duzenlendigini ozetleyen kisa serbest metin (en fazla 8 kelime). Puanlamaya girmez.",
    },
  },
  required: ["tarih", "fatura_no", "sirket_adi", "toplam_tutar", "tur", "aciklama"],
  additionalProperties: false,
};

export const SCHEMA_NAME = "fatura_verisi";

/** Alan sirasi — form, tablo ve CSV'de tutarli sira icin tek kaynak. */
export const FIELD_ORDER = [
  "tarih",
  "fatura_no",
  "sirket_adi",
  "toplam_tutar",
  "tur",
  "aciklama",
] as const;

/**
 * Puanlamaya GIRMEYEN alanlar.
 *
 * `aciklama` serbest metindir: modelin belgeyi anlamlandirip kisa bir ozet
 * yazmasi yeterli, birebir referansla eslesmesi beklenmez. Bu yuzden dogruluk
 * skoruna, alan bazli hata dokumune ve "uydurma" metrigine dahil edilmez;
 * raporda yalnizca bilgi olarak gosterilir.
 */
export const UNSCORED_FIELDS = ["aciklama"] as const;

export function isScoredField(field: (typeof FIELD_ORDER)[number]): boolean {
  return !UNSCORED_FIELDS.includes(field as (typeof UNSCORED_FIELDS)[number]);
}

/** Dogruluk hesabina giren alanlar. */
export const SCORED_FIELDS = FIELD_ORDER.filter(isScoredField);

export const FIELD_LABELS: Record<(typeof FIELD_ORDER)[number], string> = {
  tarih: "Tarih",
  fatura_no: "Fatura No",
  sirket_adi: "Şirket Adı",
  toplam_tutar: "Toplam Tutar",
  tur: "Tür",
  aciklama: "Açıklama",
};
