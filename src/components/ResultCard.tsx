"use client";

import { formatCost, projectCost } from "@/lib/cost";
import { compareToGroundTruth, VERDICT_LABELS } from "@/lib/compare";
import { FIELD_LABELS } from "@/lib/schema";
import type { ExtractResponse, GroundTruthEntry, ReceiptFields } from "@/lib/types";
import { DebugPanel } from "./DebugPanel";
import { EMPTY_RECEIPT, ReceiptForm } from "./ReceiptForm";

export interface RunState {
  status: "pending" | "done" | "failed";
  result: ExtractResponse | null;
  /** Kullanıcının düzelttiği değerler (doğrulama ekranı) */
  corrected: ReceiptFields;
  error: string | null;
}

export function ResultCard({
  modelId,
  modelLabel,
  providerLabel,
  state,
  groundTruth,
  onCorrect,
  onAcceptAsTruth,
}: {
  modelId: string;
  modelLabel: string;
  providerLabel: string;
  state: RunState;
  groundTruth: GroundTruthEntry | null;
  onCorrect: (next: ReceiptFields) => void;
  onAcceptAsTruth: () => void;
}) {
  if (state.status === "pending") {
    return (
      <div className="result-card">
        <div className="result-head">
          <div className="result-title">
            <span className="spinner" />
            <h3>{modelLabel}</h3>
            <span className="badge badge-neutral">{providerLabel}</span>
          </div>
          <span className="faint pulse">çalışıyor…</span>
        </div>
      </div>
    );
  }

  const result = state.result;

  if (state.status === "failed" || !result) {
    return (
      <div className="result-card is-error">
        <div className="result-head">
          <div className="result-title">
            <h3>{modelLabel}</h3>
            <span className="badge badge-neutral">{providerLabel}</span>
            <span className="badge badge-error">başarısız</span>
          </div>
        </div>
        <div className="panel-body">
          <div className="error-box">{state.error ?? "Bilinmeyen hata."}</div>
        </div>
      </div>
    );
  }

  const comparison = groundTruth ? compareToGroundTruth(result.parsed, groundTruth) : null;

  return (
    <div className={`result-card${result.ok ? "" : " is-error"}`}>
      <div className="result-head">
        <div className="result-title">
          <h3>{modelLabel}</h3>
          <span className="badge badge-neutral">{providerLabel}</span>
          {result.ok ? (
            <span className="badge badge-ok">JSON ✓</span>
          ) : (
            <span className="badge badge-error">JSON ✗</span>
          )}
          {comparison && comparison.scored > 0 && (
            <span
              className={`badge ${
                comparison.correct === comparison.scored
                  ? "badge-ok"
                  : comparison.correct === 0
                    ? "badge-error"
                    : "badge-warn"
              }`}
              title="Referans değeri olan alanlardan kaçı doğru"
            >
              {comparison.correct}/{comparison.scored} doğru
            </span>
          )}
          {comparison && comparison.hallucinated > 0 && (
            <span className="badge badge-warn" title="Belgede olmayan alana değer uydurdu">
              {comparison.hallucinated} uydurma
            </span>
          )}
        </div>

        <div className="metrics">
          <div className="metric">
            <span className="k">Süre</span>
            <span className="v accent">{(result.latencyMs / 1000).toFixed(2)} sn</span>
          </div>
          <div className="metric">
            <span className="k">Token</span>
            <span className="v">
              {result.usage.estimated ? "~" : ""}
              {(result.usage.inputTokens ?? 0).toLocaleString("tr-TR")} /{" "}
              {(result.usage.outputTokens ?? 0).toLocaleString("tr-TR")}
            </span>
          </div>
          <div className="metric">
            <span className="k">Maliyet</span>
            <span className="v accent">
              {result.cost.estimated ? "~" : ""}
              {formatCost(result.cost.totalCost, result.cost.currency)}
            </span>
          </div>
          <div className="metric">
            <span className="k">1000 fatura</span>
            <span className="v">
              {result.cost.estimated ? "~" : ""}
              {formatCost(projectCost(result.cost.totalCost), result.cost.currency)}
            </span>
          </div>
        </div>
      </div>

      <div className="panel-body">
        {result.parsed ? (
          <>
            <div className="row" style={{ marginBottom: 10 }}>
              <span className="faint">Doğrulama — değerleri kontrol edip gerekiyorsa düzeltin.</span>
              <span className="spacer" />
              <button
                className="btn btn-sm"
                onClick={onAcceptAsTruth}
                title="Bu değerleri referans (ground truth) olarak ayarla"
              >
                Referans kabul et
              </button>
            </div>

            <ReceiptForm
              idPrefix={modelId}
              value={state.corrected}
              original={result.parsed}
              onChange={onCorrect}
            />

            {comparison && (comparison.scored > 0 || comparison.hallucinated > 0) && (
              <div className="verdict-row">
                <span className="faint">Referansa göre:</span>
                {comparison.fields
                  .filter((f) => f.verdict !== "atlandi")
                  .map((f) => (
                    <span
                      key={f.field}
                      className={`verdict verdict-${f.verdict}`}
                      title={
                        f.verdict === "dogru"
                          ? `${FIELD_LABELS[f.field]}: doğru`
                          : f.verdict === "uydurma"
                            ? `${FIELD_LABELS[f.field]}: belgede yok, model "${f.actual}" yazdı`
                            : `${FIELD_LABELS[f.field]} — beklenen: "${f.expected}" / gelen: "${f.actual || "(boş)"}"`
                      }
                    >
                      {f.verdict === "dogru" ? "✓" : "✗"} {FIELD_LABELS[f.field]}
                      {f.verdict !== "dogru" && f.verdict !== "yanlis" && (
                        <em> ({VERDICT_LABELS[f.verdict].toLowerCase()})</em>
                      )}
                    </span>
                  ))}
              </div>
            )}
          </>
        ) : (
          <ReceiptForm idPrefix={modelId} value={EMPTY_RECEIPT} onChange={() => undefined} disabled />
        )}

        {result.warnings.length > 0 && (
          <ul className="warn-list">
            {result.warnings.map((warning, index) => (
              <li key={index}>⚠ {warning}</li>
            ))}
          </ul>
        )}

        {result.error && <div className="error-box">{result.error}</div>}

        <DebugPanel result={result} />
      </div>
    </div>
  );
}
