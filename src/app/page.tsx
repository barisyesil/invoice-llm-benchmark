"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ImageUploader, type LoadedImage } from "@/components/ImageUploader";
import { ModelPicker } from "@/components/ModelPicker";
import { ResultCard, type RunState } from "@/components/ResultCard";
import { CompareTable, type CompareRow } from "@/components/CompareTable";
import { EMPTY_RECEIPT, ReceiptForm } from "@/components/ReceiptForm";
import { SiteHeader } from "@/components/SiteHeader";
import { fieldsToGroundTruth, isGroundTruthSet } from "@/lib/compare";
import type { ExtractResponse, ModelSummary, ReceiptFields } from "@/lib/types";

export default function Page() {
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

  const [image, setImage] = useState<LoadedImage | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [running, setRunning] = useState(false);

  const [groundTruthFields, setGroundTruthFields] = useState<ReceiptFields>({ ...EMPTY_RECEIPT });

  // --- Model listesini yukle ------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/models");
        const data = await response.json();
        if (cancelled) return;

        if (data.error) {
          setConfigError(data.error);
        } else {
          setModels(data.models);
          const preselect = (data.models as ModelSummary[])
            .filter((m) => m.hasApiKey)
            .slice(0, 3)
            .map((m) => m.id);
          setSelected(new Set(preselect));
        }
      } catch (err) {
        if (!cancelled) setConfigError((err as Error).message);
      } finally {
        if (!cancelled) setModelsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const modelById = useMemo(() => {
    const map = new Map<string, ModelSummary>();
    for (const model of models) map.set(model.id, model);
    return map;
  }, [models]);

  const toggleModel = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // --- Calistir -------------------------------------------------------------
  const run = useCallback(async () => {
    if (!image || selected.size === 0) return;

    const ids = Array.from(selected);
    setRunning(true);
    setRuns(
      Object.fromEntries(
        ids.map((id) => [
          id,
          { status: "pending", result: null, corrected: { ...EMPTY_RECEIPT }, error: null } as RunState,
        ])
      )
    );

    // Modeller paralel calisir; her biri bitince kart aninda dolar.
    await Promise.all(
      ids.map(async (modelId) => {
        try {
          const response = await fetch("/api/extract", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              modelId,
              imageBase64: image.base64,
              mediaType: image.mediaType,
            }),
          });
          const data = await response.json();

          if (!response.ok || data.error) {
            setRuns((prev) => ({
              ...prev,
              [modelId]: {
                status: "failed",
                result: null,
                corrected: { ...EMPTY_RECEIPT },
                error: data.error ?? `HTTP ${response.status}`,
              },
            }));
            return;
          }

          const result = data as ExtractResponse;
          setRuns((prev) => ({
            ...prev,
            [modelId]: {
              status: "done",
              result,
              corrected: result.parsed ? { ...result.parsed } : { ...EMPTY_RECEIPT },
              error: null,
            },
          }));
        } catch (err) {
          setRuns((prev) => ({
            ...prev,
            [modelId]: {
              status: "failed",
              result: null,
              corrected: { ...EMPTY_RECEIPT },
              error: (err as Error).message,
            },
          }));
        }
      })
    );

    setRunning(false);
  }, [image, selected]);

  const rows: CompareRow[] = useMemo(
    () =>
      Object.entries(runs).map(([modelId, state]) => {
        const meta = modelById.get(modelId);
        return {
          modelId,
          modelLabel: state.result?.modelLabel ?? meta?.label ?? modelId,
          providerLabel: state.result?.providerLabel ?? meta?.providerLabel ?? "",
          state,
        };
      }),
    [runs, modelById]
  );

  const groundTruth = useMemo(() => {
    const entry = fieldsToGroundTruth(groundTruthFields);
    return isGroundTruthSet(entry) ? entry : null;
  }, [groundTruthFields]);

  const canRun = Boolean(image) && selected.size > 0 && !running;

  return (
    <div className="shell">
      <SiteHeader subtitle="Tek faturayı birden çok modele aynı anda gönderip çıktıları yan yana karşılaştırır." />

      {configError && (
        <div className="error-box" style={{ marginBottom: 20 }}>
          Konfigürasyon hatası: {configError}
        </div>
      )}

      <div className="layout">
        {/* ---------------- Sol kolon ---------------- */}
        <aside className="sidebar">
          <section className="panel">
            <div className="panel-head">
              <h2>1 · Fatura görseli</h2>
            </div>
            <div className="panel-body">
              <ImageUploader image={image} onChange={setImage} />
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>2 · Modeller</h2>
              <span className="faint">{selected.size} seçili</span>
            </div>
            <div className="panel-body">
              <ModelPicker
                models={models}
                selected={selected}
                onToggle={toggleModel}
                onSetAll={(ids) => setSelected(new Set(ids))}
                loading={modelsLoading}
              />
            </div>
          </section>

          <button className="btn btn-primary btn-block" onClick={run} disabled={!canRun}>
            {running ? (
              <>
                <span className="spinner" style={{ marginRight: 8, verticalAlign: "-2px" }} />
                Çalışıyor…
              </>
            ) : (
              `Testi çalıştır (${selected.size} model)`
            )}
          </button>

          {!image && (
            <div className="faint" style={{ textAlign: "center" }}>
              Başlamak için bir fatura görseli yükleyin.
            </div>
          )}
        </aside>

        {/* ---------------- Sağ kolon ---------------- */}
        <main className="stack">
          <section className="panel">
            <div className="panel-head">
              <h2>Referans değerler (ground truth)</h2>
              <span className="faint">
                {groundTruth ? "aktif — modeller buna göre puanlanıyor" : "opsiyonel"}
              </span>
            </div>
            <div className="panel-body">
              <p className="faint" style={{ margin: "0 0 12px" }}>
                Belgedeki doğru değerleri yazın (ya da bir sonucun üstündeki{" "}
                <em>Referans kabul et</em> düğmesini kullanın). Boş bıraktığınız alanlar
                puanlamaya girmez.
              </p>
              <ReceiptForm
                idPrefix="truth"
                value={groundTruthFields}
                onChange={setGroundTruthFields}
              />
              {groundTruth && (
                <button
                  className="btn btn-sm btn-ghost"
                  style={{ marginTop: 10 }}
                  onClick={() => setGroundTruthFields({ ...EMPTY_RECEIPT })}
                >
                  Referansı temizle
                </button>
              )}
            </div>
          </section>

          {rows.length === 0 ? (
            <div className="empty-state">
              <div className="big">🧾</div>
              <div>Henüz sonuç yok.</div>
              <div className="faint" style={{ marginTop: 6 }}>
                Soldan bir fatura yükleyip modelleri seçin, ardından testi çalıştırın.
              </div>
            </div>
          ) : (
            <>
              <CompareTable rows={rows} groundTruth={groundTruth} />

              <div className="results">
                {rows.map((row) => (
                  <ResultCard
                    key={row.modelId}
                    modelId={row.modelId}
                    modelLabel={row.modelLabel}
                    providerLabel={row.providerLabel}
                    state={row.state}
                    groundTruth={groundTruth}
                    onCorrect={(corrected) =>
                      setRuns((prev) => ({
                        ...prev,
                        [row.modelId]: { ...prev[row.modelId], corrected },
                      }))
                    }
                    onAcceptAsTruth={() => setGroundTruthFields({ ...row.state.corrected })}
                  />
                ))}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
