import type { ComparisonResult, FieldVerdict } from "./compare";
import { compareToGroundTruth } from "./compare";
import { trNumber } from "./csv";
import { FIELD_LABELS, SCORED_FIELDS } from "./schema";
import type {
  ExtractResponse,
  GroundTruthEntry,
  ModelSummary,
  ReceiptFieldName,
} from "./types";

export type BatchItemSource = "testset" | "upload";

export interface BatchItem {
  /** Benzersiz anahtar — dosya adi */
  fileName: string;
  kategori: string;
  source: BatchItemSource;
  /** Sadece kullanicinin yukledigi dosyalar icin */
  imageBase64?: string;
  mediaType?: string;
  previewUrl?: string;
  groundTruth: GroundTruthEntry | null;
  not?: string;
}

export type BatchStatus = "bekliyor" | "calisiyor" | "tamam" | "hata";

export interface BatchRun {
  item: BatchItem;
  status: BatchStatus;
  result: ExtractResponse | null;
  comparison: ComparisonResult | null;
  error: string | null;
}

export interface FieldStat {
  field: ReceiptFieldName;
  label: string;
  dogru: number;
  yanlis: number;
  eksik: number;
  uydurma: number;
  /** Puanlanabilir alan sayisi (dogru + yanlis + eksik) */
  scored: number;
  accuracy: number | null;
}

export interface BatchSummary {
  total: number;
  completed: number;
  failed: number;
  /** JSON'a cevrilebilen yanit sayisi */
  parsedOk: number;
  /** Tum puanlanabilir alanlari dogru olan belge sayisi */
  perfectDocs: number;
  scoredFields: number;
  correctFields: number;
  accuracy: number | null;
  hallucinations: number;
  totalCost: number;
  avgCost: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedUsage: boolean;
  /** Sadece PUANLANAN alanlar (aciklama haric) */
  fieldStats: FieldStat[];
  /** Puanlanmayan aciklama alanini modelin doldurdugu belge sayisi */
  aciklamaFilled: number;
  /** 1000 belge icin tahmini maliyet */
  projected1000: number;
}

export function buildComparison(
  result: ExtractResponse | null,
  groundTruth: GroundTruthEntry | null
): ComparisonResult | null {
  if (!groundTruth || !result) return null;
  return compareToGroundTruth(result.parsed, groundTruth);
}

/** Tamamlanan kosulardan ozet metrikleri hesaplar. */
export function summarize(runs: BatchRun[]): BatchSummary {
  const done = runs.filter((r) => r.status === "tamam" && r.result);
  const failed = runs.filter((r) => r.status === "hata").length;

  const fieldStats: FieldStat[] = SCORED_FIELDS.map((field) => ({
    field,
    label: FIELD_LABELS[field],
    dogru: 0,
    yanlis: 0,
    eksik: 0,
    uydurma: 0,
    scored: 0,
    accuracy: null,
  }));

  let scoredFields = 0;
  let correctFields = 0;
  let hallucinations = 0;
  let perfectDocs = 0;
  let totalCost = 0;
  let totalLatency = 0;
  let minLatency = Number.POSITIVE_INFINITY;
  let maxLatency = 0;
  let totalIn = 0;
  let totalOut = 0;
  let estimated = false;
  let parsedOk = 0;
  let aciklamaFilled = 0;

  for (const run of done) {
    const result = run.result!;
    if (result.parsed) parsedOk += 1;
    if (result.parsed && result.parsed.aciklama.trim() !== "") aciklamaFilled += 1;

    totalCost += result.cost.totalCost;
    totalLatency += result.latencyMs;
    minLatency = Math.min(minLatency, result.latencyMs);
    maxLatency = Math.max(maxLatency, result.latencyMs);
    totalIn += result.usage.inputTokens ?? 0;
    totalOut += result.usage.outputTokens ?? 0;
    if (result.usage.estimated) estimated = true;

    const comparison = run.comparison;
    if (!comparison) continue;

    scoredFields += comparison.scored;
    correctFields += comparison.correct;
    hallucinations += comparison.hallucinated;
    if (comparison.scored > 0 && comparison.correct === comparison.scored) perfectDocs += 1;

    for (const f of comparison.fields) {
      const stat = fieldStats.find((s) => s.field === f.field);
      if (stat) bump(stat, f.verdict); // puanlanmayan alanlarin istatistigi tutulmaz
    }
  }

  for (const stat of fieldStats) {
    stat.scored = stat.dogru + stat.yanlis + stat.eksik;
    stat.accuracy = stat.scored > 0 ? stat.dogru / stat.scored : null;
  }

  const completed = done.length;
  const avgCost = completed > 0 ? totalCost / completed : 0;

  return {
    total: runs.length,
    completed,
    failed,
    parsedOk,
    perfectDocs,
    scoredFields,
    correctFields,
    accuracy: scoredFields > 0 ? correctFields / scoredFields : null,
    hallucinations,
    totalCost,
    avgCost,
    totalLatencyMs: totalLatency,
    avgLatencyMs: completed > 0 ? totalLatency / completed : 0,
    minLatencyMs: Number.isFinite(minLatency) ? minLatency : 0,
    maxLatencyMs: maxLatency,
    totalInputTokens: totalIn,
    totalOutputTokens: totalOut,
    estimatedUsage: estimated,
    fieldStats,
    aciklamaFilled,
    projected1000: avgCost * 1000,
  };
}

function bump(stat: FieldStat, verdict: FieldVerdict): void {
  if (verdict === "dogru") stat.dogru += 1;
  else if (verdict === "yanlis") stat.yanlis += 1;
  else if (verdict === "eksik") stat.eksik += 1;
  else if (verdict === "uydurma") stat.uydurma += 1;
}

export interface ReportMeta {
  delaySec?: number;
}

/**
 * ---------------------------------------------------------------------------
 * Rapor tablolari
 * ---------------------------------------------------------------------------
 * Rapor ic ice gecmis metin bloklari yerine UC AYRI DIKDORTGEN TABLO olarak
 * uretilir (kunye, ozet, alan dokumu, belge detayi). Her tablo kendi basligina
 * ve sabit sutun sayisina sahiptir; boylece Excel'de duzgun bir izgara acilir,
 * filtre/pivot uygulanabilir.
 *
 * Sayilar `trNumber` ile virgullu yazilir — Turkce Excel bunlari METIN degil
 * SAYI olarak okur, yani toplam/ortalama alinabilir. Bu yuzden hucrelere "$",
 * "%" veya "sn" gibi birim EKLENMEZ; birim sutun basliginda belirtilir.
 */

/** Model/kosum kunyesi — "hangi ayarlarla olculdu" sorusunun cevabi. */
export function buildMetaRows(
  model: ModelSummary,
  summary: BatchSummary,
  meta?: ReportMeta
): (string | number)[][] {
  return [
    ["KÜNYE"],
    ["Alan", "Değer"],
    ["Rapor tarihi", new Date().toLocaleString("tr-TR")],
    ["Model", model.label],
    ["Model ID", model.model],
    ["Sağlayıcı", model.providerLabel],
    ["Yapısal çıktı", model.structuredOutput],
    ["Fiyat — giriş (USD / 1M token)", trNumber(model.pricing.inputPer1M, 4)],
    ["Fiyat — çıkış (USD / 1M token)", trNumber(model.pricing.outputPer1M, 4)],
    ["Hız limiti (rpm)", model.rpm ?? "—"],
    ["Belgeler arası bekleme (sn)", meta?.delaySec !== undefined ? trNumber(meta.delaySec, 1) : "—"],
    ["Test edilen belge", summary.total],
    ["Puanlanmayan alan", "aciklama (serbest metin, skora girmez)"],
  ];
}

/** Dogruluk + hiz + maliyet ozeti. Deger sutunu sayisal, birim ayri sutunda. */
export function buildSummaryRows(summary: BatchSummary): (string | number)[][] {
  const rows: (string | number)[][] = [
    ["ÖZET"],
    ["Metrik", "Değer", "Birim"],
    ["Başarılı çağrı", summary.completed, "belge"],
    ["Hatalı çağrı", summary.failed, "belge"],
    ["JSON'a çevrilebilen yanıt", summary.parsedOk, "belge"],
    ["Alan doğruluğu", pctNumber(summary.accuracy), "%"],
    ["Doğru alan", summary.correctFields, "alan"],
    ["Puanlanan alan", summary.scoredFields, "alan"],
    ["Tam doğru belge", summary.perfectDocs, "belge"],
    ["Uydurulan alan (belgede yok, model yazdı)", summary.hallucinations, "alan"],
    ["Açıklama yazılan belge (puanlanmaz)", summary.aciklamaFilled, "belge"],
    ["Toplam maliyet", trNumber(summary.totalCost, 6), "USD"],
    ["Belge başına ortalama maliyet", trNumber(summary.avgCost, 6), "USD"],
    ["1000 belge için tahmini maliyet", trNumber(summary.projected1000, 2), "USD"],
    ["Ortalama süre", trNumber(summary.avgLatencyMs / 1000, 2), "sn"],
    ["En hızlı çağrı", trNumber(summary.minLatencyMs / 1000, 2), "sn"],
    ["En yavaş çağrı", trNumber(summary.maxLatencyMs / 1000, 2), "sn"],
    ["Toplam süre", trNumber(summary.totalLatencyMs / 1000, 2), "sn"],
    ["Toplam giriş token", summary.totalInputTokens, "token"],
    ["Toplam çıkış token", summary.totalOutputTokens, "token"],
  ];

  if (summary.estimatedUsage) {
    rows.push([
      "UYARI",
      "Bazı çağrılarda sağlayıcı token kullanımı raporlamadı — maliyet tahminidir.",
      "",
    ]);
  }
  return rows;
}

/** Alan bazli hata dokumu — sadece puanlanan alanlar. */
export function buildFieldStatsRows(summary: BatchSummary): (string | number)[][] {
  const rows: (string | number)[][] = [
    ["ALAN BAZLI HATA DÖKÜMÜ"],
    ["Alan", "Doğru", "Yanlış", "Eksik", "Uydurma", "Puanlanan", "Doğruluk (%)"],
  ];
  for (const stat of summary.fieldStats) {
    rows.push([
      stat.label,
      stat.dogru,
      stat.yanlis,
      stat.eksik,
      stat.uydurma,
      stat.scored,
      pctNumber(stat.accuracy),
    ]);
  }
  rows.push([FIELD_LABELS.aciklama, "—", "—", "—", "—", 0, "puanlanmaz"]);
  return rows;
}

/** Belge bazli detay — her belge tek satir, sabit sutunlar. */
export function buildDetailRows(runs: BatchRun[]): (string | number)[][] {
  const header: string[] = ["Dosya", "Kategori", "Durum", "JSON"];
  for (const field of SCORED_FIELDS) {
    header.push(
      `${FIELD_LABELS[field]} — model`,
      `${FIELD_LABELS[field]} — referans`,
      `${FIELD_LABELS[field]} — sonuç`
    );
  }
  header.push(
    `${FIELD_LABELS.aciklama} — model (puanlanmaz)`,
    "Doğru",
    "Yanlış",
    "Eksik",
    "Uydurma",
    "Puanlanan",
    "Doğruluk (%)",
    "Süre (sn)",
    "Deneme",
    "Giriş token",
    "Çıkış token",
    "Maliyet (USD)",
    "Uyarılar",
    "Hata",
    "Referans notu"
  );

  const rows: (string | number)[][] = [["BELGE BAZLI SONUÇLAR"], header];

  for (const run of runs) {
    const result = run.result;
    const comparison = run.comparison;
    const parsed = result?.parsed ?? null;

    const line: (string | number)[] = [
      run.item.fileName,
      run.item.kategori,
      statusText(run),
      result ? (parsed ? "evet" : "hayır") : "",
    ];

    for (const field of SCORED_FIELDS) {
      const cf = comparison?.fields.find((f) => f.field === field);
      const actual = parsed
        ? field === "toplam_tutar"
          ? trNumber(parsed.toplam_tutar, 2)
          : String(parsed[field])
        : "";
      const expected =
        cf === undefined
          ? ""
          : cf.expected === null
            ? "(belgede yok)"
            : field === "toplam_tutar"
              ? trNumber(Number(cf.expected), 2)
              : cf.expected;
      line.push(actual, expected, cf ? verdictText(cf.verdict) : "");
    }

    line.push(
      parsed?.aciklama ?? "",
      comparison?.correct ?? "",
      comparison?.wrong ?? "",
      comparison?.missing ?? "",
      comparison?.hallucinated ?? "",
      comparison?.scored ?? "",
      comparison ? pctNumber(comparison.accuracy) : "",
      result ? trNumber(result.latencyMs / 1000, 2) : "",
      result?.debug.attempts ?? "",
      result?.usage.inputTokens ?? "",
      result?.usage.outputTokens ?? "",
      result ? trNumber(result.cost.totalCost, 6) : "",
      result?.warnings.join(" | ") ?? "",
      run.error ?? result?.error ?? "",
      run.item.not ?? ""
    );
    rows.push(line);
  }

  return rows;
}

/**
 * Tum bolumleri tek dosyada birlestirir. Bolumler arasinda bos satir birakilir;
 * satirlar en genis tabloya gore doldurulur ki Excel duzgun bir izgara acsin.
 */
export function buildReportRows(
  model: ModelSummary,
  runs: BatchRun[],
  summary: BatchSummary,
  meta?: ReportMeta
): (string | number)[][] {
  return [
    ...buildMetaRows(model, summary, meta),
    [],
    ...buildSummaryRows(summary),
    [],
    ...buildFieldStatsRows(summary),
    [],
    ...buildDetailRows(runs),
  ];
}

/** Ham sonuclar — tekrar analiz/arsiv icin. Gorseller ve ham istek govdesi haric. */
export function buildReportJson(
  model: ModelSummary,
  runs: BatchRun[],
  summary: BatchSummary,
  meta?: ReportMeta
): string {
  return JSON.stringify(
    {
      olusturma: new Date().toISOString(),
      model: {
        id: model.id,
        label: model.label,
        model: model.model,
        saglayici: model.providerLabel,
        yapisalCikti: model.structuredOutput,
        fiyat: model.pricing,
        rpm: model.rpm ?? null,
      },
      kosum: { belgelerArasiBeklemeSn: meta?.delaySec ?? null },
      puanlama: {
        puanlananAlanlar: [...SCORED_FIELDS],
        puanlanmayanAlanlar: ["aciklama"],
      },
      ozet: summary,
      belgeler: runs.map((run) => ({
        dosya: run.item.fileName,
        kategori: run.item.kategori,
        durum: run.status,
        not: run.item.not ?? null,
        referans: run.item.groundTruth,
        model: run.result?.parsed ?? null,
        karsilastirma: run.comparison,
        uyarilar: run.result?.warnings ?? [],
        hata: run.error ?? run.result?.error ?? null,
        sureMs: run.result?.latencyMs ?? null,
        deneme: run.result?.debug.attempts ?? null,
        kullanim: run.result?.usage ?? null,
        maliyet: run.result?.cost ?? null,
      })),
    },
    null,
    2
  );
}

/** Oran -> yuzde sayisi (virgullu, Excel'de sayi). Olculemiyorsa tire. */
function pctNumber(ratio: number | null): string {
  return ratio === null ? "—" : trNumber(ratio * 100, 1);
}

function statusText(run: BatchRun): string {
  if (run.status === "tamam" && run.result && !run.result.parsed) return "JSON hatası";
  return run.status;
}

function verdictText(verdict: FieldVerdict): string {
  switch (verdict) {
    case "dogru":
      return "DOĞRU";
    case "yanlis":
      return "YANLIŞ";
    case "eksik":
      return "EKSİK";
    case "uydurma":
      return "UYDURMA";
    case "bilgi":
      return "BİLGİ";
    default:
      return "—";
  }
}
