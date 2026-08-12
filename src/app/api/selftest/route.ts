import { NextResponse } from "next/server";
import { normalizeReceipt } from "@/lib/normalize";
import { deepMerge, redactBase64, redactHeaders } from "@/lib/utils";
import { computeCost } from "@/lib/cost";
import { compareToGroundTruth } from "@/lib/compare";
import { summarize, type BatchRun } from "@/lib/batch";
import { BELGE_TURLERI, RECEIPT_SCHEMA } from "@/lib/schema";
import { listTestSet } from "@/lib/testset";
import type { ExtractResponse, GroundTruthEntry, ModelConfig, ReceiptFields } from "@/lib/types";

export const dynamic = "force-dynamic";

const TAIL =
  '"fatura_no":"PF-004","sirket_adi":"Örnek A.Ş.","toplam_tutar":1234.56,"tur":"Fatura","aciklama":"Danışmanlık"';

export async function GET() {
  const checks: { name: string; pass: boolean; got: unknown }[] = [];
  const check = (name: string, pass: boolean, got: unknown) => checks.push({ name, pass, got });

  // ---------- normalize ----------
  const clean = normalizeReceipt(`{"tarih":"2026-03-07",${TAIL}}`);
  check(
    "temiz json (6 alan)",
    clean.parsed?.toplam_tutar === 1234.56 &&
      clean.parsed?.tur === "Fatura" &&
      clean.parsed?.aciklama === "Danışmanlık" &&
      clean.warnings.length === 0,
    clean
  );

  const messy = normalizeReceipt(
    'Tabii, iste sonuc:\n```json\n{"tarih":"07.03.2026","fatura_no":"FATURA NO: PF-004","sirket_adi":"  Örnek   A.Ş. ","toplam_tutar":"1.234,56 TL","tur":"fatura","aciklama":"null"}\n```'
  );
  check(
    "markdown + TR format + etiket + sozluk disi tur",
    messy.parsed?.tarih === "2026-03-07" &&
      messy.parsed?.fatura_no === "PF-004" &&
      messy.parsed?.sirket_adi === "Örnek A.Ş." &&
      messy.parsed?.toplam_tutar === 1234.56 &&
      messy.parsed?.tur === "Fatura" &&
      messy.parsed?.aciklama === "",
    messy.parsed
  );

  const textualDate = normalizeReceipt(`{"tarih":"5 Eylül 2025",${TAIL}}`);
  check("yazili ay", textualDate.parsed?.tarih === "2025-09-05", textualDate.parsed?.tarih);

  const singleDigit = normalizeReceipt(`{"tarih":"6/8/2025",${TAIL}}`);
  check("tek haneli gun/ay", singleDigit.parsed?.tarih === "2025-08-06", singleDigit.parsed?.tarih);

  const broken = normalizeReceipt("Bu bir fatura degil, JSON uretemedim.");
  check("bozuk cikti null doner", broken.parsed === null, broken.warnings);

  const wrapped = normalizeReceipt(`{"fatura":{"tarih":"2026-03-07",${TAIL}}}`);
  check("ic ice nesne", wrapped.parsed?.fatura_no === "PF-004", wrapped.parsed?.fatura_no);

  // ---------- karsilastirma ----------
  const expected: GroundTruthEntry = {
    tarih: "2026-04-10",
    fatura_no: null, // belgede yok
    sirket_adi: "METRO GROSMARKET",
    toplam_tutar: 180.9,
    tur: "POS Slip",
    aciklama: null,
  };

  const perfect = compareToGroundTruth(
    {
      tarih: "2026-04-10",
      fatura_no: "",
      sirket_adi: "METRO GROSMARKET-ESKİŞEHİR-STANDART",
      toplam_tutar: 180.9,
      tur: "POS Slip",
      aciklama: "",
    },
    expected
  );
  check(
    "hosgorulu sirket adi + null alanlar skora girmez",
    perfect.scored === 4 && perfect.correct === 4 && perfect.hallucinated === 0,
    perfect
  );

  const hallucinating = compareToGroundTruth(
    {
      tarih: "2026-04-10",
      fatura_no: "897567", // belgede fatura no YOK -> uydurma
      sirket_adi: "Metro Grosmarket",
      toplam_tutar: 180.9,
      tur: "Market Fişi", // yanlis tur
      aciklama: "",
    },
    expected
  );
  check(
    "uydurma + yanlis tur ayirt edilir",
    hallucinating.hallucinated === 1 &&
      hallucinating.wrong === 1 &&
      hallucinating.correct === 3 &&
      hallucinating.scored === 4,
    hallucinating.fields.map((f) => `${f.field}:${f.verdict}`)
  );

  const missing = compareToGroundTruth(
    { tarih: "", fatura_no: "", sirket_adi: "METRO GROSMARKET", toplam_tutar: 0, tur: "", aciklama: "" },
    expected
  );
  check(
    "bos birakilan alanlar 'eksik' sayilir",
    missing.missing === 3 && missing.correct === 1,
    missing.fields.map((f) => `${f.field}:${f.verdict}`)
  );

  const docIdTolerance = compareToGroundTruth(
    { tarih: "", fatura_no: "37", sirket_adi: "", toplam_tutar: 0, tur: "", aciklama: "" },
    { tarih: null, fatura_no: "0037", sirket_adi: null, toplam_tutar: null, tur: null, aciklama: null }
  );
  check("bastaki sifir toleransi", docIdTolerance.correct === 1, docIdTolerance.fields[1]);

  // aciklama puanlanmaz: referanstan farkli yazilsa da ne yanlis ne uydurma sayilir
  const freeText = compareToGroundTruth(
    {
      tarih: "2026-04-10",
      fatura_no: "",
      sirket_adi: "METRO GROSMARKET",
      toplam_tutar: 180.9,
      tur: "POS Slip",
      aciklama: "Kart ile market ödemesi",
    },
    { ...expected, aciklama: "Market alışverişi" }
  );
  check(
    "aciklama puanlamaya girmez",
    freeText.scored === 4 &&
      freeText.correct === 4 &&
      freeText.wrong === 0 &&
      freeText.hallucinated === 0 &&
      freeText.fields.find((f) => f.field === "aciklama")?.verdict === "bilgi",
    freeText.fields.map((f) => `${f.field}:${f.verdict}`)
  );

  // Yeni tur degerleri sozluge girdi mi (e-fatura + abonelik ornekleri icin)
  const yeniTurler = normalizeReceipt(
    '{"tarih":"2021-03-31","fatura_no":"BBA1","sirket_adi":"X","toplam_tutar":1,"tur":"abonelik faturasi","aciklama":"Elektrik"}'
  );
  check(
    "yeni tur sozlugu (buyuk/kucuk harf toleransli)",
    yeniTurler.parsed?.tur === "Abonelik Faturası" && BELGE_TURLERI.includes("e-Fatura"),
    yeniTurler.parsed?.tur
  );

  // Eski TL faturalarinda binlik ayirici virgul olabiliyor: "45,750,000"
  const oldLira = normalizeReceipt(
    '{"tarih":"2002-02-26","fatura_no":"1","sirket_adi":"İGDAŞ","toplam_tutar":"45,750,000 TL","tur":"Abonelik Faturası","aciklama":"Doğalgaz"}'
  );
  check(
    "coklu binlik ayirici (45,750,000)",
    oldLira.parsed?.toplam_tutar === 45750000,
    oldLira.parsed?.toplam_tutar
  );

  // ---------- batch ozeti ----------
  const fakeRuns: BatchRun[] = [
    makeRun(
      "a.png",
      expected,
      { tarih: "2026-04-10", fatura_no: "", sirket_adi: "METRO GROSMARKET", toplam_tutar: 180.9, tur: "POS Slip", aciklama: "" },
      1000,
      0.001
    ),
    makeRun(
      "b.png",
      expected,
      { tarih: "2026-01-01", fatura_no: "X1", sirket_adi: "Baska Firma", toplam_tutar: 1, tur: "Fatura", aciklama: "Market alışverişi" },
      3000,
      0.003
    ),
  ];
  const summary = summarize(fakeRuns);
  check(
    "batch ozeti",
    summary.completed === 2 &&
      summary.scoredFields === 8 && // 2 belge x 4 puanlanabilir alan (aciklama haric)
      summary.correctFields === 4 &&
      summary.perfectDocs === 1 &&
      summary.hallucinations === 1 &&
      summary.aciklamaFilled === 1 &&
      summary.fieldStats.every((s) => s.field !== "aciklama") &&
      Math.abs(summary.avgLatencyMs - 2000) < 1 &&
      Math.abs(summary.projected1000 - 2) < 1e-9,
    {
      scored: summary.scoredFields,
      correct: summary.correctFields,
      perfect: summary.perfectDocs,
      halluc: summary.hallucinations,
      aciklamaFilled: summary.aciklamaFilled,
      alanlar: summary.fieldStats.map((s) => s.field),
      projected1000: summary.projected1000,
    }
  );

  const tarihStat = summary.fieldStats.find((s) => s.field === "tarih")!;
  check("alan bazli istatistik", tarihStat.dogru === 1 && tarihStat.yanlis === 1, tarihStat);

  // ---------- yardimcilar ----------
  const merged = deepMerge(
    { output_config: { format: { type: "json_schema" } }, model: "x" },
    { output_config: { effort: "low" } }
  );
  check(
    "deepMerge",
    JSON.stringify(merged) ===
      '{"output_config":{"format":{"type":"json_schema"},"effort":"low"},"model":"x"}',
    merged
  );

  const red = redactBase64({ data: "A".repeat(4000), model: "gpt-4o-mini" }) as Record<string, string>;
  check("base64 maskeleme", red.data.startsWith("<base64") && red.model === "gpt-4o-mini", red);

  const headers = redactHeaders({
    "x-api-key": "sk-ant-api03-SECRETVALUE1234",
    "content-type": "application/json",
  });
  check(
    "header maskeleme",
    !headers["x-api-key"].includes("SECRETVALUE") && headers["content-type"] === "application/json",
    headers
  );

  const cost = computeCost(
    { pricing: { inputPer1M: 1, outputPer1M: 5 } } as ModelConfig,
    { inputTokens: 1_000_000, outputTokens: 200_000, totalTokens: null, estimated: false },
    "USD"
  );
  check("maliyet", Math.abs(cost.totalCost - 2) < 1e-9, cost);

  const { toGeminiSchemaForTest } = await import("@/lib/providers/google");
  const gem = toGeminiSchemaForTest(RECEIPT_SCHEMA) as Record<string, unknown>;
  const gemProps = gem.properties as Record<string, { type: string; enum?: string[] }>;
  check(
    "gemini sema (enum korunur)",
    gem.type === "OBJECT" &&
      !("additionalProperties" in gem) &&
      gemProps.toplam_tutar.type === "NUMBER" &&
      Array.isArray(gemProps.tur.enum) &&
      gemProps.tur.enum.includes("Proforma Fatura"),
    gem
  );

  // ---------- test seti ----------
  const testSet = listTestSet();
  check("test seti yuklendi (referanslariyla)", testSet.length > 0 && testSet.every((i) => i.hasGroundTruth), {
    adet: testSet.length,
    referanssiz: testSet.filter((i) => !i.hasGroundTruth).map((i) => i.fileName),
  });

  const failed = checks.filter((c) => !c.pass);
  return NextResponse.json(
    { passed: checks.length - failed.length, total: checks.length, failed, checks },
    { status: failed.length === 0 ? 200 : 500 }
  );
}

function makeRun(
  fileName: string,
  groundTruth: GroundTruthEntry,
  parsed: ReceiptFields,
  latencyMs: number,
  cost: number
): BatchRun {
  const result: ExtractResponse = {
    modelId: "m",
    modelLabel: "M",
    providerLabel: "P",
    ok: true,
    latencyMs,
    parsed,
    warnings: [],
    error: null,
    usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120, estimated: false },
    cost: { inputCost: cost, outputCost: 0, totalCost: cost, currency: "USD", estimated: false },
    debug: {
      url: "",
      httpStatus: 200,
      requestHeaders: {},
      requestBody: null,
      responseBody: null,
      rawText: null,
      imageBytes: 0,
      attempts: 1,
      retriedOn: [],
    },
  };
  return {
    item: { fileName, kategori: "test", source: "testset", groundTruth },
    status: "tamam",
    result,
    comparison: compareToGroundTruth(parsed, groundTruth),
    error: null,
  };
}
