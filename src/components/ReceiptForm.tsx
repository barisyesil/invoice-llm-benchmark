"use client";

import { BELGE_TURLERI, FIELD_LABELS } from "@/lib/schema";
import type { ReceiptFields } from "@/lib/types";

export const EMPTY_RECEIPT: ReceiptFields = {
  tarih: "",
  fatura_no: "",
  sirket_adi: "",
  toplam_tutar: 0,
  tur: "",
  aciklama: "",
};

/**
 * Human-in-the-loop doğrulama formu (6 alan).
 * `original` verilirse, değiştirilen alanlar sarı kenarlıkla işaretlenir.
 */
export function ReceiptForm({
  value,
  original,
  onChange,
  idPrefix,
  disabled = false,
}: {
  value: ReceiptFields;
  original?: ReceiptFields | null;
  onChange: (next: ReceiptFields) => void;
  idPrefix: string;
  disabled?: boolean;
}) {
  const edited = (field: keyof ReceiptFields) =>
    original ? String(original[field]) !== String(value[field]) : false;

  const cls = (field: keyof ReceiptFields) => (edited(field) ? "edited" : "");

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="field-grid">
        <div className="field">
          <label htmlFor={`${idPrefix}-tarih`}>{FIELD_LABELS.tarih} (YYYY-MM-DD)</label>
          <input
            id={`${idPrefix}-tarih`}
            className={cls("tarih")}
            value={value.tarih}
            placeholder="2026-03-07"
            disabled={disabled}
            onChange={(e) => onChange({ ...value, tarih: e.target.value })}
          />
        </div>

        <div className="field">
          <label htmlFor={`${idPrefix}-faturano`}>{FIELD_LABELS.fatura_no}</label>
          <input
            id={`${idPrefix}-faturano`}
            className={cls("fatura_no")}
            value={value.fatura_no}
            placeholder="PF-2024-001"
            disabled={disabled}
            onChange={(e) => onChange({ ...value, fatura_no: e.target.value })}
          />
        </div>

        <div className="field">
          <label htmlFor={`${idPrefix}-tutar`}>{FIELD_LABELS.toplam_tutar}</label>
          <input
            id={`${idPrefix}-tutar`}
            className={cls("toplam_tutar")}
            type="number"
            step="0.01"
            value={Number.isFinite(value.toplam_tutar) ? value.toplam_tutar : 0}
            placeholder="0.00"
            disabled={disabled}
            onChange={(e) =>
              onChange({ ...value, toplam_tutar: Number.parseFloat(e.target.value) || 0 })
            }
          />
        </div>
      </div>

      <div className="field-grid">
        <div className="field">
          <label htmlFor={`${idPrefix}-sirket`}>{FIELD_LABELS.sirket_adi}</label>
          <input
            id={`${idPrefix}-sirket`}
            className={cls("sirket_adi")}
            value={value.sirket_adi}
            placeholder="Örnek Market A.Ş."
            disabled={disabled}
            onChange={(e) => onChange({ ...value, sirket_adi: e.target.value })}
          />
        </div>

        <div className="field">
          <label htmlFor={`${idPrefix}-tur`}>{FIELD_LABELS.tur}</label>
          <select
            id={`${idPrefix}-tur`}
            className={cls("tur")}
            value={value.tur}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, tur: e.target.value })}
          >
            <option value="">— seçilmedi —</option>
            {BELGE_TURLERI.map((tur) => (
              <option key={tur} value={tur}>
                {tur}
              </option>
            ))}
            {value.tur !== "" && !BELGE_TURLERI.includes(value.tur as never) && (
              <option value={value.tur}>{value.tur} (sözlük dışı)</option>
            )}
          </select>
        </div>

        <div className="field">
          <label htmlFor={`${idPrefix}-aciklama`}>{FIELD_LABELS.aciklama}</label>
          <input
            id={`${idPrefix}-aciklama`}
            className={cls("aciklama")}
            value={value.aciklama}
            placeholder="(varsa)"
            disabled={disabled}
            onChange={(e) => onChange({ ...value, aciklama: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}
