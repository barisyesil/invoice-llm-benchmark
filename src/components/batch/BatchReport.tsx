"use client";

import { Fragment, useState } from "react";
import {
  buildDetailRows,
  buildReportJson,
  buildReportRows,
  type BatchRun,
  type BatchSummary,
} from "@/lib/batch";
import { downloadCsv, downloadJson, slugify, timestampSlug } from "@/lib/csv";
import { formatCost } from "@/lib/cost";
import { FIELD_LABELS, FIELD_ORDER, isScoredField } from "@/lib/schema";
import type { ModelSummary } from "@/lib/types";
import { DebugPanel } from "../DebugPanel";

export function BatchReport({
  model,
  runs,
  summary,
  delaySec,
}: {
  model: ModelSummary;
  runs: BatchRun[];
  summary: BatchSummary;
  delaySec?: number;
}) {
  const [openFile, setOpenFile] = useState<string | null>(null);
  const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);

  const baseName = `${slugify(model.label)}-rapor-${timestampSlug()}`;

  /** Künye + özet + alan dökümü + belge tablosu — tek dosyada, dört ayrı tablo. */
  function exportFullCsv() {
    downloadCsv(`${baseName}.csv`, buildReportRows(model, runs, summary, { delaySec }));
  }

  /** Sadece belge tablosu — filtre/pivot için tek başlık satırlı temiz tablo. */
  function exportDetailCsv() {
    downloadCsv(`${baseName}-belgeler.csv`, buildDetailRows(runs).slice(1));
  }

  function exportJson() {
    downloadJson(`${baseName}.json`, buildReportJson(model, runs, summary, { delaySec }));
  }

  return (
    <div className="stack">
      {/* ---------- Özet kartları ---------- */}
      <section className="panel">
        <div className="panel-head">
          <h2>{model.label} — Rapor</h2>
          <div className="row">
            <span className="faint">
              {summary.completed}/{summary.total} tamamlandı
              {summary.failed > 0 && ` · ${summary.failed} hata`}
            </span>
            <button
              className="btn btn-sm btn-primary"
              onClick={exportFullCsv}
              title="Künye + özet + alan dökümü + belge tablosu (Excel-TR uyumlu)"
            >
              Tam rapor (CSV)
            </button>
            <button
              className="btn btn-sm"
              onClick={exportDetailCsv}
              title="Tek başlık satırı + her belge için bir satır — filtre/pivot için"
            >
              Belge tablosu (CSV)
            </button>
            <button className="btn btn-sm" onClick={exportJson} title="Ham sonuçlar (arşiv/analiz)">
              JSON
            </button>
          </div>
        </div>

        <div className="panel-body">
          <div className="stat-grid">
            <Stat
              label="Alan doğruluğu"
              value={pct(summary.accuracy)}
              sub={`${summary.correctFields} / ${summary.scoredFields} alan`}
              tone={toneFor(summary.accuracy)}
            />
            <Stat
              label="Tam doğru belge"
              value={`${summary.perfectDocs}/${summary.completed}`}
              sub="tüm alanları doğru"
              tone={toneFor(summary.completed > 0 ? summary.perfectDocs / summary.completed : null)}
            />
            <Stat
              label="Uydurma"
              value={String(summary.hallucinations)}
              sub="belgede yok, model yazdı"
              tone={summary.hallucinations === 0 ? "ok" : "warn"}
            />
            <Stat
              label="Toplam maliyet"
              value={`${summary.estimatedUsage ? "~" : ""}${formatCost(summary.totalCost)}`}
              sub={`belge başı ${formatCost(summary.avgCost)}`}
            />
            <Stat
              label="1000 belge"
              value={`${summary.estimatedUsage ? "~" : ""}$${summary.projected1000.toFixed(2)}`}
              sub="tahmini maliyet"
            />
            <Stat
              label="Ort. süre"
              value={`${(summary.avgLatencyMs / 1000).toFixed(2)} sn`}
              sub={`min ${(summary.minLatencyMs / 1000).toFixed(1)} · maks ${(summary.maxLatencyMs / 1000).toFixed(1)}`}
            />
            <Stat
              label="Token (g/ç)"
              value={`${summary.totalInputTokens.toLocaleString("tr-TR")} / ${summary.totalOutputTokens.toLocaleString("tr-TR")}`}
              sub={summary.estimatedUsage ? "kısmen tahmini" : "sağlayıcı raporu"}
            />
            <Stat
              label="JSON başarısı"
              value={`${summary.parsedOk}/${summary.completed}`}
              sub="ayrıştırılabilen yanıt"
              tone={summary.parsedOk === summary.completed ? "ok" : "warn"}
            />
          </div>
        </div>
      </section>

      {/* ---------- Alan bazlı hata dökümü ---------- */}
      <section className="panel">
        <div className="panel-head">
          <h2>Alan bazlı hata dökümü</h2>
          <span className="faint">
            Model hangi alanda zorlanıyor? · <strong>Açıklama</strong> puanlamaya girmez (
            {summary.aciklamaFilled}/{summary.completed} belgede dolduruldu)
          </span>
        </div>
        <div className="table-wrap">
          <table className="compare">
            <thead>
              <tr>
                <th>Alan</th>
                <th className="num-head">Doğru</th>
                <th className="num-head">Yanlış</th>
                <th className="num-head">Eksik</th>
                <th className="num-head">Uydurma</th>
                <th>Doğruluk</th>
                <th style={{ width: "28%" }}>Dağılım</th>
              </tr>
            </thead>
            <tbody>
              {summary.fieldStats.map((stat) => (
                <tr key={stat.field}>
                  <td>
                    <strong>{stat.label}</strong>
                  </td>
                  <td className="num mark-ok">{stat.dogru || ""}</td>
                  <td className="num mark-bad">{stat.yanlis || ""}</td>
                  <td className="num" style={{ color: "var(--warn)" }}>
                    {stat.eksik || ""}
                  </td>
                  <td className="num" style={{ color: "var(--info)" }}>
                    {stat.uydurma || ""}
                  </td>
                  <td className={stat.accuracy !== null && stat.accuracy < 0.6 ? "mark-bad" : ""}>
                    {pct(stat.accuracy)}
                  </td>
                  <td>
                    <Bar stat={stat} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------- Belge bazlı sonuçlar ---------- */}
      <section className="panel">
        <div className="panel-head">
          <h2>Belge bazlı sonuçlar</h2>
          <span className="faint">Satıra tıklayın: ham istek/yanıt ve alan karşılaştırması</span>
        </div>
        <div className="table-wrap">
          <table className="compare">
            <thead>
              <tr>
                <th>Dosya</th>
                <th>Durum</th>
                {FIELD_ORDER.map((f) => (
                  <th key={f} title={isScoredField(f) ? undefined : "Puanlamaya girmez"}>
                    {FIELD_LABELS[f]}
                    {!isScoredField(f) && <span className="faint"> (bilgi)</span>}
                  </th>
                ))}
                <th>Skor</th>
                <th className="num-head">Süre</th>
                <th className="num-head">Maliyet</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const result = run.result;
                const comparison = run.comparison;
                const isOpen = openFile === run.item.fileName;

                return (
                  <Fragment key={run.item.fileName}>
                    <tr
                      onClick={() => setOpenFile(isOpen ? null : run.item.fileName)}
                      style={{ cursor: "pointer" }}
                      className={isOpen ? "row-open" : undefined}
                    >
                      <td>
                        <span className="mono">{run.item.fileName}</span>
                        {!run.item.groundTruth && (
                          <span className="badge badge-warn" style={{ marginLeft: 6 }}>
                            referanssız
                          </span>
                        )}
                      </td>
                      <td>
                        <StatusChip run={run} />
                      </td>
                      {FIELD_ORDER.map((field) => {
                        const cf = comparison?.fields.find((f) => f.field === field);
                        const value = result?.parsed
                          ? field === "toplam_tutar"
                            ? result.parsed.toplam_tutar.toFixed(2)
                            : String(result.parsed[field])
                          : undefined;
                        return (
                          <td key={field} className="mono cell-wrap">
                            <FieldCell value={value} verdict={cf?.verdict} expected={cf?.expected} />
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
                      <td className="num">
                        {result ? `${(result.latencyMs / 1000).toFixed(2)} sn` : "—"}
                      </td>
                      <td className="num">
                        {result ? formatCost(result.cost.totalCost) : "—"}
                      </td>
                    </tr>

                    {isOpen && (
                      <tr>
                        <td colSpan={FIELD_ORDER.length + 5} className="detail-cell">
                          <div className="detail-body">
                            <div className="detail-image">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={
                                  run.item.source === "testset"
                                    ? `/api/testset/image/${encodeURIComponent(run.item.fileName)}`
                                    : (run.item.previewUrl ?? "")
                                }
                                alt={run.item.fileName}
                              />
                              {run.item.not && <p className="faint">{run.item.not}</p>}
                            </div>
                            <div className="detail-main">
                              {comparison && (
                                <table className="compare mini">
                                  <thead>
                                    <tr>
                                      <th>Alan</th>
                                      <th>Beklenen</th>
                                      <th>Model</th>
                                      <th>Sonuç</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {comparison.fields.map((f) => (
                                      <tr key={f.field}>
                                        <td>{FIELD_LABELS[f.field]}</td>
                                        <td className="mono cell-wrap">
                                          {f.expected ?? (
                                            <span className="mark-na">
                                              {f.verdict === "bilgi" ? "—" : "(belgede yok)"}
                                            </span>
                                          )}
                                        </td>
                                        <td className="mono cell-wrap">
                                          {f.actual || <span className="mark-na">(boş)</span>}
                                        </td>
                                        <td>
                                          <span className={`verdict verdict-${f.verdict}`}>
                                            {f.verdict === "dogru" ? "✓ doğru" : verdictLabel(f.verdict)}
                                          </span>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}

                              {result?.warnings.length ? (
                                <ul className="warn-list">
                                  {result.warnings.map((w, i) => (
                                    <li key={i}>⚠ {w}</li>
                                  ))}
                                </ul>
                              ) : null}

                              {(run.error || result?.error) && (
                                <div className="error-box">{run.error ?? result?.error}</div>
                              )}

                              {result && <DebugPanel result={result} />}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "ok" | "warn" | "bad";
}) {
  return (
    <div className={`stat${tone ? ` stat-${tone}` : ""}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function toneFor(ratio: number | null): "ok" | "warn" | "bad" | undefined {
  if (ratio === null) return undefined;
  if (ratio >= 0.9) return "ok";
  if (ratio >= 0.6) return "warn";
  return "bad";
}

function Bar({
  stat,
}: {
  stat: { dogru: number; yanlis: number; eksik: number; uydurma: number };
}) {
  const total = stat.dogru + stat.yanlis + stat.eksik + stat.uydurma;
  if (total === 0) return <span className="mark-na">—</span>;
  const seg = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className="bar" title={`doğru ${stat.dogru} · yanlış ${stat.yanlis} · eksik ${stat.eksik} · uydurma ${stat.uydurma}`}>
      {stat.dogru > 0 && <span className="bar-ok" style={{ width: seg(stat.dogru) }} />}
      {stat.yanlis > 0 && <span className="bar-bad" style={{ width: seg(stat.yanlis) }} />}
      {stat.eksik > 0 && <span className="bar-warn" style={{ width: seg(stat.eksik) }} />}
      {stat.uydurma > 0 && <span className="bar-info" style={{ width: seg(stat.uydurma) }} />}
    </div>
  );
}

function StatusChip({ run }: { run: BatchRun }) {
  if (run.status === "bekliyor") return <span className="badge badge-neutral">bekliyor</span>;
  if (run.status === "calisiyor")
    return (
      <span className="badge badge-info">
        <span className="spinner" style={{ width: 9, height: 9 }} /> çalışıyor
      </span>
    );
  if (run.status === "hata") return <span className="badge badge-error">hata</span>;
  if (run.result && !run.result.parsed) return <span className="badge badge-error">JSON ✗</span>;
  if (run.result && run.result.debug.attempts > 1) {
    return (
      <span
        className="badge badge-warn"
        title={`Geçici hata sonrası ${run.result.debug.attempts}. denemede alındı: ${run.result.debug.retriedOn.join(" → ")}`}
      >
        tamam ({run.result.debug.attempts}. deneme)
      </span>
    );
  }
  return <span className="badge badge-ok">tamam</span>;
}

function FieldCell({
  value,
  verdict,
  expected,
}: {
  value?: string;
  verdict?: string;
  expected?: string | null;
}) {
  if (value === undefined) return <span className="mark-na">—</span>;
  const text = value === "" ? "(boş)" : value;
  if (!verdict || verdict === "atlandi" || verdict === "bilgi") return <>{text}</>;
  if (verdict === "dogru") return <span className="mark-ok">✓ {text}</span>;
  return (
    <span className="mark-bad" title={expected ? `beklenen: ${expected}` : verdict}>
      ✗ {text}
    </span>
  );
}

function verdictLabel(verdict: string): string {
  if (verdict === "yanlis") return "✗ yanlış";
  if (verdict === "eksik") return "✗ eksik";
  if (verdict === "uydurma") return "✗ uydurma";
  if (verdict === "bilgi") return "bilgi — puanlanmaz";
  return "—";
}
