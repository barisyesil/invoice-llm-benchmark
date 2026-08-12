"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { TestSetPicker } from "@/components/batch/TestSetPicker";
import { BatchReport } from "@/components/batch/BatchReport";
import { buildComparison, summarize, type BatchItem, type BatchRun } from "@/lib/batch";
import type { ExtractResponse, ModelSummary, TestSetItem } from "@/lib/types";

type Source = "testset" | "upload";

const DELAY_STORAGE_KEY = "invoice-llm-benchmark:batch-delay-sec";
const MODEL_STORAGE_KEY = "invoice-llm-benchmark:batch-model-id";

/** Modelin RPM limitinden guvenli bekleme suresi (saniye). */
function recommendedDelay(model: ModelSummary | null): number {
  if (!model?.rpm || model.rpm <= 0) return 0;
  // 60/rpm tam sinirdir; %10 pay birakip 0.5 sn adimlara yuvarliyoruz.
  return Math.ceil((60 / model.rpm) * 1.1 * 2) / 2;
}

export default function TopluTestPage() {
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [modelId, setModelId] = useState<string>("");
  const [testSet, setTestSet] = useState<TestSetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

  const [source, setSource] = useState<Source>("testset");
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [uploads, setUploads] = useState<BatchItem[]>([]);

  const [runs, setRuns] = useState<BatchRun[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [waitMs, setWaitMs] = useState(0);

  // Istekler arasi bekleme (saniye). Free tier'da hiz limitine takilmamak icin.
  const [delaySec, setDelaySec] = useState(0);
  const [delayTouched, setDelayTouched] = useState(false);

  const cancelRef = useRef(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  // --- Veri yukle -----------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [modelsRes, testSetRes] = await Promise.all([
          fetch("/api/models").then((r) => r.json()),
          fetch("/api/testset").then((r) => r.json()),
        ]);
        if (cancelled) return;

        if (modelsRes.error) setConfigError(modelsRes.error);
        else {
          const list = modelsRes.models as ModelSummary[];
          setModels(list);
          // Son secilen modeli hatirla; hala kullanilabilir degilse ilk uygun modele don.
          const remembered = window.localStorage.getItem(MODEL_STORAGE_KEY);
          const pick =
            list.find((m) => m.id === remembered && m.hasApiKey) ??
            list.find((m) => m.hasApiKey);
          if (pick) setModelId(pick.id);
        }

        if (!testSetRes.error) {
          setTestSet(testSetRes.items);
          setSelectedFiles(new Set((testSetRes.items as TestSetItem[]).map((i) => i.fileName)));
        }
      } catch (err) {
        if (!cancelled) setConfigError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Kullanicinin son sectigi bekleme suresini hatirla
  useEffect(() => {
    const stored = window.localStorage.getItem(DELAY_STORAGE_KEY);
    if (stored !== null) {
      const value = Number.parseFloat(stored);
      if (Number.isFinite(value) && value >= 0) {
        setDelaySec(value);
        setDelayTouched(true);
      }
    }
  }, []);

  const selectedModel = useMemo(
    () => models.find((m) => m.id === modelId) ?? null,
    [models, modelId]
  );

  const suggestedDelay = recommendedDelay(selectedModel);

  // Model degistiginde, kullanici elle dokunmadiysa oneriyi uygula
  useEffect(() => {
    if (!delayTouched && selectedModel) setDelaySec(suggestedDelay);
  }, [selectedModel, suggestedDelay, delayTouched]);

  const updateDelay = useCallback((value: number) => {
    const safe = Number.isFinite(value) && value >= 0 ? Math.min(value, 300) : 0;
    setDelaySec(safe);
    setDelayTouched(true);
    window.localStorage.setItem(DELAY_STORAGE_KEY, String(safe));
  }, []);

  // --- Calistirilacak listeyi kur ------------------------------------------
  const queue: BatchItem[] = useMemo(() => {
    if (source === "upload") return uploads;
    return testSet
      .filter((item) => selectedFiles.has(item.fileName))
      .map((item) => ({
        fileName: item.fileName,
        kategori: item.kategori,
        source: "testset" as const,
        groundTruth: item.groundTruth,
        not: item.not,
      }));
  }, [source, uploads, testSet, selectedFiles]);

  const toggleFile = useCallback((fileName: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(fileName)) next.delete(fileName);
      else next.add(fileName);
      return next;
    });
  }, []);

  // --- Kendi dosyalarini yukle ---------------------------------------------
  const handleUploads = useCallback(async (fileList: FileList) => {
    const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));

    const items = await Promise.all(
      files.map(
        (file) =>
          new Promise<BatchItem>((resolve) => {
            const reader = new FileReader();
            reader.onload = async () => {
              const dataUrl = String(reader.result);
              const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
              // Referansi dosya adina gore ara — kullanici kendi dosyasini da puanlayabilsin
              let groundTruth = null;
              try {
                const res = await fetch(
                  `/api/testset/groundtruth?file=${encodeURIComponent(file.name)}`
                );
                const json = await res.json();
                groundTruth = json.groundTruth ?? null;
              } catch {
                /* referans yoksa sorun degil */
              }
              resolve({
                fileName: file.name,
                kategori: "yüklenen",
                source: "upload",
                imageBase64: base64,
                mediaType: file.type,
                previewUrl: dataUrl,
                groundTruth,
              });
            };
            reader.readAsDataURL(file);
          })
      )
    );

    setUploads(items);
    setSource("upload");
  }, []);

  /** Iptal edilebilir bekleme — geri sayimi arayuze yansitir. */
  const waitBetween = useCallback(async (ms: number) => {
    if (ms <= 0) return;
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (cancelRef.current) break;
      setWaitMs(Math.max(0, end - Date.now()));
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    setWaitMs(0);
  }, []);

  // --- Sirali kosum ---------------------------------------------------------
  const run = useCallback(async () => {
    if (!selectedModel || queue.length === 0) return;

    cancelRef.current = false;
    setRunning(true);
    setProgress({ done: 0, total: queue.length });
    setWaitMs(0);

    const initial: BatchRun[] = queue.map((item) => ({
      item,
      status: "bekliyor",
      result: null,
      comparison: null,
      error: null,
    }));
    setRuns(initial);

    for (let i = 0; i < queue.length; i += 1) {
      if (cancelRef.current) break;

      // Ilk belge haric, her istekten once hiz limiti beklemesi
      if (i > 0) {
        await waitBetween(delaySec * 1000);
        if (cancelRef.current) break;
      }

      const item = queue[i];
      setRuns((prev) => prev.map((r, idx) => (idx === i ? { ...r, status: "calisiyor" } : r)));

      try {
        const body =
          item.source === "testset"
            ? { modelId: selectedModel.id, testSetFile: item.fileName }
            : {
                modelId: selectedModel.id,
                imageBase64: item.imageBase64,
                mediaType: item.mediaType,
              };

        const response = await fetch("/api/extract", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await response.json();

        if (!response.ok || data.error) {
          setRuns((prev) =>
            prev.map((r, idx) =>
              idx === i
                ? { ...r, status: "hata", error: data.error ?? `HTTP ${response.status}` }
                : r
            )
          );
        } else {
          const result = data as ExtractResponse;
          const comparison = buildComparison(result, item.groundTruth);
          setRuns((prev) =>
            prev.map((r, idx) => (idx === i ? { ...r, status: "tamam", result, comparison } : r))
          );
        }
      } catch (err) {
        setRuns((prev) =>
          prev.map((r, idx) =>
            idx === i ? { ...r, status: "hata", error: (err as Error).message } : r
          )
        );
      }

      setProgress({ done: i + 1, total: queue.length });
    }

    setWaitMs(0);
    setRunning(false);
  }, [selectedModel, queue, delaySec, waitBetween]);

  const summary = useMemo(() => summarize(runs), [runs]);
  const hasResults = runs.some((r) => r.status === "tamam" || r.status === "hata");
  const canRun = Boolean(selectedModel?.hasApiKey) && queue.length > 0 && !running;

  // Kaba sure tahmini: (bekleme + ~3 sn ortalama cagri) x belge sayisi
  const estimatedSec = queue.length > 0 ? (delaySec + 3) * queue.length - delaySec : 0;

  return (
    <div className="shell">
      <SiteHeader subtitle="Tek modeli çok sayıda fatura üzerinde sırayla çalıştırır; doğruluk, hata dağılımı ve maliyeti raporlar." />

      {configError && (
        <div className="error-box" style={{ marginBottom: 20 }}>
          Konfigürasyon hatası: {configError}
        </div>
      )}

      <div className="stack">
        {/* ---------- 1. Model ---------- */}
        <section className="panel">
          <div className="panel-head">
            <h2>1 · Test edilecek model</h2>
            <span className="faint">Toplu testte tek model çalıştırılır</span>
          </div>
          <div className="panel-body">
            {loading ? (
              <div className="faint pulse">Yükleniyor…</div>
            ) : (
              <div className="model-radio-grid">
                {models.map((model) => (
                  <label
                    key={model.id}
                    className={`model-radio${modelId === model.id ? " selected" : ""}${
                      model.hasApiKey ? "" : " disabled"
                    }`}
                  >
                    <input
                      type="radio"
                      name="model"
                      checked={modelId === model.id}
                      disabled={!model.hasApiKey || running}
                      onChange={() => {
                        setModelId(model.id);
                        window.localStorage.setItem(MODEL_STORAGE_KEY, model.id);
                      }}
                    />
                    <div>
                      <div className="model-row-name">
                        <span>{model.label}</span>
                        {!model.hasApiKey && <span className="badge badge-error">anahtar yok</span>}
                        {model.rpm ? (
                          <span className="badge badge-neutral" title="Konfigürasyondaki dakikalık istek limiti">
                            {model.rpm} rpm
                          </span>
                        ) : null}
                      </div>
                      <div className="model-row-meta">
                        {model.providerLabel} · ${model.pricing.inputPer1M}/$
                        {model.pricing.outputPer1M} /1M
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ---------- 2. Belgeler ---------- */}
        <section className="panel">
          <div className="panel-head">
            <h2>2 · Faturalar</h2>
            <div className="row">
              <button
                className={`btn btn-sm${source === "testset" ? " btn-primary" : ""}`}
                onClick={() => setSource("testset")}
                disabled={running}
              >
                Test seti ({testSet.length})
              </button>
              <button
                className={`btn btn-sm${source === "upload" ? " btn-primary" : ""}`}
                onClick={() => uploadInputRef.current?.click()}
                disabled={running}
              >
                Kendi dosyalarım{uploads.length > 0 ? ` (${uploads.length})` : ""}
              </button>
              <input
                ref={uploadInputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => e.target.files && handleUploads(e.target.files)}
              />
            </div>
          </div>
          <div className="panel-body">
            {source === "testset" ? (
              <TestSetPicker
                items={testSet}
                selected={selectedFiles}
                onToggle={toggleFile}
                onSetMany={(files) => setSelectedFiles(new Set(files))}
                loading={loading}
                disabled={running}
              />
            ) : uploads.length === 0 ? (
              <div className="faint">
                Henüz dosya seçilmedi. <strong>Kendi dosyalarım</strong> düğmesiyle birden fazla
                görsel seçebilirsiniz. Dosya adı <code>testset/ground-truth.json</code> içindeki bir
                kayıtla eşleşirse otomatik puanlanır.
              </div>
            ) : (
              <div className="thumb-grid">
                {uploads.map((item) => (
                  <div key={item.fileName} className="thumb selected">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.previewUrl} alt={item.fileName} />
                    <span className="thumb-name">{item.fileName}</span>
                    {!item.groundTruth && (
                      <span className="badge badge-warn thumb-badge">referans yok</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ---------- 3. Hız limiti ---------- */}
        <section className="panel">
          <div className="panel-head">
            <h2>3 · Hız limiti</h2>
            <span className="faint">Ücretsiz (free tier) hesaplarda 429 almamak için</span>
          </div>
          <div className="panel-body">
            <div className="rate-row">
              <div className="field" style={{ maxWidth: 190 }}>
                <label htmlFor="delay">Belgeler arası bekleme</label>
                <div className="input-suffix">
                  <input
                    id="delay"
                    type="number"
                    min={0}
                    max={300}
                    step={0.5}
                    value={delaySec}
                    disabled={running}
                    onChange={(e) => updateDelay(Number.parseFloat(e.target.value))}
                  />
                  <span>saniye</span>
                </div>
              </div>

              <div className="rate-presets">
                <span className="faint">Hazır:</span>
                {[0, 2, 4, 6, 10, 15].map((sec) => (
                  <button
                    key={sec}
                    className={`btn btn-sm${delaySec === sec ? " btn-primary" : " btn-ghost"}`}
                    disabled={running}
                    onClick={() => updateDelay(sec)}
                  >
                    {sec === 0 ? "beklemesiz" : `${sec} sn`}
                  </button>
                ))}
              </div>
            </div>

            <div className="rate-hint">
              {selectedModel?.rpm ? (
                <>
                  <strong>{selectedModel.label}</strong> için konfigürasyondaki limit{" "}
                  <strong>{selectedModel.rpm} istek/dakika</strong> → önerilen bekleme{" "}
                  <strong>{suggestedDelay} sn</strong>.
                  {delaySec !== suggestedDelay && (
                    <button
                      className="btn btn-sm btn-ghost"
                      style={{ marginLeft: 8 }}
                      disabled={running}
                      onClick={() => updateDelay(suggestedDelay)}
                    >
                      Öneriyi uygula
                    </button>
                  )}
                </>
              ) : selectedModel ? (
                <>
                  <strong>{selectedModel.label}</strong> için limit tanımlı değil. Modelin{" "}
                  <code>rpm</code> değerini <code>config/models.json</code> içine yazarsanız burada
                  otomatik önerilir.
                </>
              ) : (
                "Bir model seçin."
              )}
            </div>

            <div className="faint" style={{ marginTop: 6 }}>
              {delaySec > 0 ? (
                <>
                  Bu ayarla dakikada en fazla{" "}
                  <strong>{Math.floor(60 / (delaySec + 0.0001))} istek</strong> gönderilir.
                </>
              ) : (
                "Bekleme yok — istekler arka arkaya gönderilir."
              )}{" "}
              {queue.length > 0 && (
                <>
                  {queue.length} belge için kaba süre tahmini:{" "}
                  <strong>~{formatDuration(estimatedSec)}</strong>.
                </>
              )}{" "}
              Yine de 429 alırsanız süreyi artırın; geçici hatalar ayrıca otomatik yeniden denenir.
            </div>
          </div>
        </section>

        {/* ---------- 4. Çalıştır ---------- */}
        <section className="panel">
          <div className="panel-body">
            <div className="row">
              <button className="btn btn-primary" onClick={run} disabled={!canRun}>
                {running ? (
                  <>
                    <span className="spinner" style={{ marginRight: 8, verticalAlign: "-2px" }} />
                    {progress.done}/{progress.total} işleniyor…
                  </>
                ) : (
                  `Toplu testi başlat (${queue.length} belge)`
                )}
              </button>

              {running && (
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    cancelRef.current = true;
                  }}
                >
                  Durdur
                </button>
              )}

              <span className="spacer" />

              {running && waitMs > 0 ? (
                <span className="badge badge-info">
                  hız limiti beklemesi: {(waitMs / 1000).toFixed(1)} sn
                </span>
              ) : (
                selectedModel && (
                  <span className="faint">
                    {selectedModel.label} · {queue.length} belge · {delaySec} sn aralıkla
                  </span>
                )
              )}
            </div>

            {progress.total > 0 && (
              <div className="progress">
                <div
                  className="progress-fill"
                  style={{ width: `${(progress.done / progress.total) * 100}%` }}
                />
              </div>
            )}
          </div>
        </section>

        {/* ---------- 5. Rapor ---------- */}
        {hasResults && selectedModel ? (
          <BatchReport
            model={selectedModel}
            runs={runs}
            summary={summary}
            delaySec={delaySec}
          />
        ) : (
          !running && (
            <div className="empty-state">
              <div className="big">📊</div>
              <div>Henüz rapor yok.</div>
              <div className="faint" style={{ marginTop: 6 }}>
                Bir model ve faturaları seçip toplu testi başlatın.
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} sn`;
  const min = Math.floor(seconds / 60);
  const sec = Math.round(seconds % 60);
  return sec === 0 ? `${min} dk` : `${min} dk ${sec} sn`;
}
