"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface LoadedImage {
  /** "data:image/jpeg;base64,..." — onizleme icin */
  dataUrl: string;
  /** Sadece base64 govdesi — API'ye gonderilen */
  base64: string;
  mediaType: string;
  fileName: string;
  bytes: number;
}

const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_BYTES = 15 * 1024 * 1024;

export function ImageUploader({
  image,
  onChange,
}: {
  image: LoadedImage | null;
  onChange: (image: LoadedImage | null) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      setError(null);

      if (!ACCEPTED.includes(file.type)) {
        setError(`Desteklenmeyen tür: ${file.type || "bilinmiyor"}. JPEG, PNG, WebP veya GIF yükleyin.`);
        return;
      }
      if (file.size > MAX_BYTES) {
        setError(`Dosya çok büyük (${(file.size / 1024 / 1024).toFixed(1)} MB). Üst sınır 15 MB.`);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result);
        const comma = dataUrl.indexOf(",");
        onChange({
          dataUrl,
          base64: dataUrl.slice(comma + 1),
          mediaType: file.type,
          fileName: file.name,
          bytes: file.size,
        });
      };
      reader.onerror = () => setError("Dosya okunamadı.");
      reader.readAsDataURL(file);
    },
    [onChange]
  );

  // Panodan yapistirma (Ctrl+V) — ekran goruntusu ile hizli test icin.
  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      const item = Array.from(event.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith("image/")
      );
      const file = item?.getAsFile();
      if (file) handleFile(file);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [handleFile]);

  if (image) {
    return (
      <div className="stack">
        <div className="preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.dataUrl} alt={`Yüklenen fiş: ${image.fileName}`} />
          <div className="preview-meta">
            <span title={image.fileName}>{truncate(image.fileName, 28)}</span>
            <span>
              {(image.bytes / 1024).toFixed(0)} KB · {image.mediaType.replace("image/", "").toUpperCase()}
            </span>
          </div>
        </div>
        <div className="row">
          <button className="btn btn-sm" onClick={() => inputRef.current?.click()}>
            Değiştir
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => onChange(null)}>
            Kaldır
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED.join(",")}
          hidden
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
      </div>
    );
  }

  return (
    <div className="stack">
      <div
        className={`dropzone${dragging ? " dragging" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) handleFile(file);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
      >
        <strong>Fiş görselini buraya sürükleyin</strong>
        <div className="hint">veya tıklayıp seçin · Ctrl+V ile yapıştırın</div>
        <div className="hint" style={{ marginTop: 8 }}>
          JPEG · PNG · WebP · maks. 15 MB
        </div>
      </div>
      {error && <div className="error-box">{error}</div>}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(",")}
        hidden
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
      />
    </div>
  );
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}
