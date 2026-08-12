"use client";

import { useMemo } from "react";
import type { TestSetItem } from "@/lib/types";

/** Test setindeki görselleri kategoriye göre gruplayıp seçtiren ızgara. */
export function TestSetPicker({
  items,
  selected,
  onToggle,
  onSetMany,
  loading,
  disabled,
}: {
  items: TestSetItem[];
  selected: Set<string>;
  onToggle: (fileName: string) => void;
  onSetMany: (fileNames: string[]) => void;
  loading: boolean;
  disabled: boolean;
}) {
  const groups = useMemo(() => {
    const out: Record<string, TestSetItem[]> = {};
    for (const item of items) (out[item.kategori] ||= []).push(item);
    return out;
  }, [items]);

  if (loading) {
    return <div className="faint pulse">Test seti yükleniyor…</div>;
  }

  if (items.length === 0) {
    return (
      <div className="faint">
        <code>testset/images/</code> klasörü boş. Görselleri oraya koyup{" "}
        <code>testset/ground-truth.json</code> dosyasına aynı dosya adıyla referans ekleyin.
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="row">
        <button
          className="btn btn-sm btn-ghost"
          disabled={disabled}
          onClick={() => onSetMany(items.map((i) => i.fileName))}
        >
          Tümü ({items.length})
        </button>
        {Object.entries(groups).map(([kategori, group]) => (
          <button
            key={kategori}
            className="btn btn-sm btn-ghost"
            disabled={disabled}
            onClick={() => onSetMany(group.map((i) => i.fileName))}
          >
            {kategori} ({group.length})
          </button>
        ))}
        <button
          className="btn btn-sm btn-ghost"
          disabled={disabled || selected.size === 0}
          onClick={() => onSetMany([])}
        >
          Temizle
        </button>
      </div>

      {Object.entries(groups).map(([kategori, group]) => (
        <div key={kategori}>
          <div className="model-group-label">{kategori}</div>
          <div className="thumb-grid">
            {group.map((item) => {
              const isSelected = selected.has(item.fileName);
              return (
                <button
                  key={item.fileName}
                  type="button"
                  className={`thumb${isSelected ? " selected" : ""}`}
                  onClick={() => !disabled && onToggle(item.fileName)}
                  disabled={disabled}
                  title={item.not ?? item.fileName}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/testset/image/${encodeURIComponent(item.fileName)}`}
                    alt={item.fileName}
                    loading="lazy"
                  />
                  <span className="thumb-name">{item.fileName}</span>
                  {!item.hasGroundTruth && (
                    <span className="badge badge-warn thumb-badge">referans yok</span>
                  )}
                  {isSelected && <span className="thumb-check">✓</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
