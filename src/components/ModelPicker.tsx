"use client";

import type { ModelSummary } from "@/lib/types";

export function ModelPicker({
  models,
  selected,
  onToggle,
  onSetAll,
  loading,
}: {
  models: ModelSummary[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onSetAll: (ids: string[]) => void;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="faint pulse" style={{ padding: "18px 0" }}>
        Modeller yükleniyor…
      </div>
    );
  }

  if (models.length === 0) {
    return (
      <div className="faint">
        Aktif model yok. <code>config/models.json</code> içinde en az bir modelin{" "}
        <code>enabled: true</code> olduğundan emin olun.
      </div>
    );
  }

  const available = models.filter((m) => m.hasApiKey).map((m) => m.id);
  const grouped = groupBy(models, (m) => m.providerLabel);

  return (
    <div className="stack">
      <div className="row">
        <button
          className="btn btn-sm btn-ghost"
          onClick={() => onSetAll(available)}
          disabled={available.length === 0}
        >
          Anahtarı olanların hepsi ({available.length})
        </button>
        <button
          className="btn btn-sm btn-ghost"
          onClick={() => onSetAll([])}
          disabled={selected.size === 0}
        >
          Temizle
        </button>
      </div>

      <div className="model-list">
        {Object.entries(grouped).map(([providerLabel, group]) => (
          <div key={providerLabel}>
            <div className="model-group-label">{providerLabel}</div>
            {group.map((model) => {
              const isSelected = selected.has(model.id);
              const disabled = !model.hasApiKey;
              return (
                <label
                  key={model.id}
                  className={`model-row${isSelected ? " selected" : ""}${disabled ? " disabled" : ""}`}
                  title={disabled ? `${model.apiKeyEnv} tanımlı değil` : model.notes}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={disabled}
                    onChange={() => onToggle(model.id)}
                  />
                  <div className="model-row-main">
                    <div className="model-row-name">
                      <span>{model.label}</span>
                      {disabled && <span className="badge badge-error">anahtar yok</span>}
                      {model.structuredOutput === "json_schema" && (
                        <span className="badge badge-ok" title="Yapısal çıktı: JSON şeması zorlanıyor">
                          şema
                        </span>
                      )}
                      {model.structuredOutput === "json_object" && (
                        <span
                          className="badge badge-warn"
                          title="Sadece JSON modu — şema zorlanamıyor, prompt'a güveniliyor"
                        >
                          json
                        </span>
                      )}
                      {model.structuredOutput === "none" && (
                        <span className="badge badge-neutral" title="Yapısal çıktı desteği yok">
                          serbest
                        </span>
                      )}
                    </div>
                    <div className="model-row-meta">
                      {model.model} · ${model.pricing.inputPer1M}/${model.pricing.outputPer1M} /1M
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const item of items) {
    const k = key(item);
    (out[k] ||= []).push(item);
  }
  return out;
}
