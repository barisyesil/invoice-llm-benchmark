/**
 * CSV uretimi ve indirme.
 *
 * Ayirici olarak NOKTALI VIRGUL kullanilir: Turkce Windows/Excel yerel ayarinda
 * varsayilan liste ayiricisi budur, virgul kullanilirsa tum satir tek hucreye duser.
 * Basa BOM eklenir ki Excel Turkce karakterleri dogru gostersin.
 *
 * Sayilar `trNumber` ile VIRGULLU ondalik yazilir; boylece Turkce Excel onlari
 * metin degil sayi olarak okur ve toplam/ortalama/grafik alinabilir. Bu yuzden
 * hucrelere "$", "%" gibi birim yazilmaz — birim sutun basliginda belirtilir.
 */
const SEP = ";";

/** Satirlari en genis satira gore doldurur: Excel duzgun bir izgara acsin. */
function padRows(rows: (string | number)[][]): (string | number)[][] {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return rows.map((row) => {
    if (row.length === width) return row;
    return [...row, ...Array<string>(width - row.length).fill("")];
  });
}

export function toCsv(rows: (string | number)[][]): string {
  const body = padRows(rows)
    .map((row) => row.map(escapeCell).join(SEP))
    .join("\r\n");
  return `﻿${body}\r\n`;
}

export function downloadCsv(fileName: string, rows: (string | number)[][]): void {
  downloadBlob(fileName, toCsv(rows), "text/csv;charset=utf-8");
}

export function downloadJson(fileName: string, json: string): void {
  downloadBlob(fileName, json, "application/json;charset=utf-8");
}

function downloadBlob(fileName: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Bazi tarayicilar indirmeyi bir sonraki tick'te basliyor; hemen revoke edersek
  // dosya bos inebiliyor.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Sayiyi Turkce ondalik ayiriciyla yazar. Binlik ayirici KULLANILMAZ (Excel takilir). */
export function trNumber(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "";
  return value.toFixed(decimals).replace(".", ",");
}

function escapeCell(value: string | number): string {
  const text =
    typeof value === "number"
      ? trNumber(value, Number.isInteger(value) ? 0 : 6)
      : String(value ?? "");
  if (new RegExp(`["${SEP}\\n\\r]`).test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** Dosya adinda kullanilabilir hale getirir. */
export function slugify(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .replaceAll("ı", "i")
    .replaceAll("ğ", "g")
    .replaceAll("ü", "u")
    .replaceAll("ş", "s")
    .replaceAll("ö", "o")
    .replaceAll("ç", "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function timestampSlug(): string {
  return new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
}
