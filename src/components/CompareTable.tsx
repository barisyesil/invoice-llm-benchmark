"use client";

import { formatCost, projectCost } from "@/lib/cost";
import { compareToGroundTruth } from "@/lib/compare";
import { FIELD_LABELS, FIELD_ORDER, SCORED_FIELDS, isScoredField } from "@/lib/schema";
import type { GroundTruthEntry } from "@/lib/types";
import { downloadCsv, trNumber } from "@/lib/csv";
import type { RunState } from "./ResultCard";

export interface CompareRow {
  modelId: string;
  modelLabel: string;
  providerLabel: string;
  state: RunState;
}

/** Tekli testte modelleri yan yana karşılaştıran tablo. */
export function CompareTable({
  rows,
  groundTruth,
}: {
  rows: CompareRow[];
  groundTruth: GroundTruthEntry | null;
}) {
  const done = rows.filter((r) => r.state.status === "done" && r.state.result);
  if (done.length === 0) return null;

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Karşılaştırma</h2>
        <span className="faint">
          {groundTruth
            ? "Doğruluk, referans değerlere göre hesaplandı · Açıklama puanlanmaz"
            : "Referans değer girilince doğruluk sütunu dolar"}
        </span>
      </div>
      <div className="table-wrap">
        <table className="compare">
          <thead>
            <tr>
              <th>Model</th>
              {FIELD_ORDER.map((f) => (
                <th
                  key={f}
                  className={f === "toplam_tutar" ? "num-head" : undefined}
                  title={isScoredField(f) ? undefined : "Puanlamaya girmez"}
                >
                  {FIELD_LABELS[f]}
                  {!isScoredField(f) && <span className="faint"> (bilgi)</span>}
                </th>
              ))}
              <th>Doğruluk</th>
              <th className="num-head">Süre</th>
              <th className="num-head">Token (g/ç)</th>
              <th className="num-head">Maliyet</th>
            </tr>
          </thead>
          <tbody>
            {done.map((row) => {
              const result = row.state.result!;
              const parsed = result.parsed;
              const comparison = groundTruth
                ? compareToGroundTruth(parsed, groundTruth)
                : null;

              return (
                <tr key={row.modelId}>
                  <td>
                    <strong>{row.modelLabel}</strong>
                    <div className="faint" style={{ fontSize: 11 }}>
                      {row.providerLabel}
                    </div>
                  </td>

                  {FIELD_ORDER.map((field) => {
                    const verdict = comparison?.fields.find((f) => f.field === field)?.verdict;
                    const raw = parsed
                      ? field === "toplam_tutar"
                        ? parsed.toplam_tutar.toFixed(2)
                        : String(parsed[field])
                      : undefined;
                    return (
                      <td
                        key={field}
                        className={field === "toplam_tutar" ? "num mono" : "mono cell-wrap"}
                      >
                        <Cell value={raw} verdict={verdict} />
                      </td>
                    );
                  })}

                  <td>
                    {comparison && comparison.scored > 0 ? (
                      <span
                        className={
                          comparison.correct === comparison.scored
                            ? "mark-ok"
                            : comparison.correct === 0
                              ? "mark-bad"
                              : ""
                        }
                      >
                        {comparison.correct}/{comparison.scored}
                      </span>
                    ) : (
                      <span className="mark-na">—</span>
                    )}
                  </td>
                  <td className="num">{(result.latencyMs / 1000).toFixed(2)} sn</td>
                  <td className="num">
                    {result.usage.estimated ? "~" : ""}
                    {(result.usage.inputTokens ?? 0).toLocaleString("tr-TR")} /{" "}
                    {(result.usage.outputTokens ?? 0).toLocaleString("tr-TR")}
                  </td>
                  <td className="num">
                    {result.cost.estimated ? "~" : ""}
                    {formatCost(result.cost.totalCost, result.cost.currency)}
                    <div className="faint" style={{ fontSize: 10 }}>
                      1000×: {formatCost(projectCost(result.cost.totalCost))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="panel-body" style={{ borderTop: "1px solid var(--border)" }}>
        <button className="btn btn-sm" onClick={() => exportSingle(done, groundTruth)}>
          CSV indir
        </button>
        <span className="faint" style={{ marginLeft: 10 }}>
          Çok sayıda faturayı tek modelle test etmek için <strong>Toplu Test</strong> sekmesini kullanın.
        </span>
      </div>
    </div>
  );
}

function Cell({ value, verdict }: { value?: string; verdict?: string }) {
  if (value === undefined) return <span className="mark-na">—</span>;
  const text = value === "" ? "(boş)" : value;
  if (!verdict || verdict === "atlandi" || verdict === "bilgi") return <>{text}</>;
  const ok = verdict === "dogru";
  return (
    <span className={ok ? "mark-ok" : "mark-bad"} title={verdict}>
      {ok ? "✓" : "✗"} {text}
    </span>
  );
}

/**
 * Tek belge / cok model karsilastirmasini tek basliklı, dikdortgen bir tablo
 * olarak indirir. Sayilar Turkce ondalikla yazilir (Excel'de sayi olarak acilir),
 * birimler sutun basliginda belirtilir.
 */
function exportSingle(rows: CompareRow[], groundTruth: GroundTruthEntry | null) {
  const header: string[] = ["Model", "Sağlayıcı", "JSON"];
  for (const field of SCORED_FIELDS) {
    header.push(`${FIELD_LABELS[field]} — model`, `${FIELD_LABELS[field]} — referans`, `${FIELD_LABELS[field]} — sonuç`);
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
    "Giriş token",
    "Çıkış token",
    "Maliyet (USD)",
    "1000 belge (USD)",
    "Uyarılar",
    "Hata"
  );

  const lines = rows.map((row) => {
    const result = row.state.result!;
    const parsed = result.parsed;
    const c = groundTruth ? compareToGroundTruth(parsed, groundTruth) : null;

    const line: (string | number)[] = [
      row.modelLabel,
      row.providerLabel,
      parsed ? "evet" : "hayır",
    ];

    for (const field of SCORED_FIELDS) {
      const cf = c?.fields.find((f) => f.field === field);
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
      c?.correct ?? "",
      c?.wrong ?? "",
      c?.missing ?? "",
      c?.hallucinated ?? "",
      c?.scored ?? "",
      c?.accuracy != null ? trNumber(c.accuracy * 100, 1) : "",
      trNumber(result.latencyMs / 1000, 2),
      result.usage.inputTokens ?? "",
      result.usage.outputTokens ?? "",
      trNumber(result.cost.totalCost, 6),
      trNumber(projectCost(result.cost.totalCost), 2),
      result.warnings.join(" | "),
      result.error ?? ""
    );
    return line;
  });

  downloadCsv(`tekli-test-${timestamp()}.csv`, [header, ...lines]);
}

function verdictText(verdict: string): string {
  if (verdict === "dogru") return "DOĞRU";
  if (verdict === "yanlis") return "YANLIŞ";
  if (verdict === "eksik") return "EKSİK";
  if (verdict === "uydurma") return "UYDURMA";
  return "—";
}

function timestamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}
