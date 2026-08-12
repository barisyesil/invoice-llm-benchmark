"use client";

import { useState } from "react";
import type { ExtractResponse } from "@/lib/types";

export function DebugPanel({ result }: { result: ExtractResponse }) {
  const { debug, usage, cost } = result;

  return (
    <details className="debug">
      <summary>Ham istek / yanıt · debug</summary>

      <div className="row" style={{ marginTop: 10, fontSize: 12 }}>
        <span className="badge badge-neutral">
          {debug.httpStatus > 0 ? `HTTP ${debug.httpStatus}` : "bağlantı hatası"}
        </span>
        <span className="mono faint">{debug.url}</span>
        {debug.attempts > 1 && (
          <span className="badge badge-warn" title={debug.retriedOn.join(" → ")}>
            {debug.attempts}. denemede alındı
          </span>
        )}
        <span className="spacer" />
        <span className="faint">
          görsel: {(debug.imageBytes / 1024).toFixed(0)} KB
        </span>
      </div>

      {debug.retriedOn.length > 0 && (
        <div className="faint" style={{ marginTop: 6 }}>
          Geçici hata nedeniyle yeniden denendi: {debug.retriedOn.join(" → ")}
        </div>
      )}

      <div className="row" style={{ marginTop: 8, fontSize: 12 }}>
        <span className="faint">
          giriş token: <span className="mono">{fmt(usage.inputTokens, usage.estimated)}</span>
        </span>
        <span className="faint">
          çıkış token: <span className="mono">{fmt(usage.outputTokens, usage.estimated)}</span>
        </span>
        <span className="faint">
          toplam: <span className="mono">{fmt(usage.totalTokens, usage.estimated)}</span>
        </span>
        <span className="faint">
          maliyet ayrımı:{" "}
          <span className="mono">
            giriş ${cost.inputCost.toFixed(6)} + çıkış ${cost.outputCost.toFixed(6)}
          </span>
        </span>
      </div>

      {usage.estimated && (
        <div className="faint" style={{ marginTop: 6 }}>
          ⚠ Sağlayıcı token kullanımı raporlamadı — değerler tahmindir (<code>~</code>), maliyet de
          yaklaşıktır.
        </div>
      )}

      <div className="debug-grid">
        <CodeBlock title="İstek (base64 kısaltıldı)" data={debug.requestBody} extra={debug.requestHeaders} />
        <CodeBlock title="Yanıt (ham)" data={debug.responseBody} />
      </div>

      {debug.rawText !== null && (
        <div style={{ marginTop: 12 }}>
          <CodeBlock title="Modelin ürettiği ham metin" data={debug.rawText} raw />
        </div>
      )}
    </details>
  );
}

function CodeBlock({
  title,
  data,
  extra,
  raw = false,
}: {
  title: string;
  data: unknown;
  extra?: Record<string, string>;
  raw?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const text = raw && typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const headerText = extra ? `// headers\n${JSON.stringify(extra, null, 2)}\n\n// body\n` : "";
  const full = `${headerText}${text}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* pano erişimi yoksa sessizce geç */
    }
  }

  return (
    <div className="code-block">
      <div className="code-block-head">
        <span>{title}</span>
        <button className="btn btn-sm btn-ghost" onClick={copy}>
          {copied ? "kopyalandı ✓" : "kopyala"}
        </button>
      </div>
      <pre>{full}</pre>
    </div>
  );
}

function fmt(value: number | null, estimated: boolean): string {
  if (value === null) return "—";
  return `${estimated ? "~" : ""}${value.toLocaleString("tr-TR")}`;
}
