"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { fmt, type Dict } from "@/lib/i18n";
import { errorMessage } from "@/lib/i18n/errors";
import type { VariantEditorRow } from "@/lib/listing-service";

type Row = VariantEditorRow & { priceText: string };

/** « Mes annonces » : modifier une annonce à variantes en ligne (principale, photos, prix, quantités) sans la retirer. */
export default function VariantManager({ listingId, t, tl, errors }: { listingId: string; t: Dict["listings"]["variants"]; tl: Dict["listing"]; errors: Dict["errors"] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [currency, setCurrency] = useState("");
  const [main, setMain] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const showError = (d: { error?: string; detail?: string }) => setError(fmt(errorMessage(errors, d.error ?? "UPSTREAM"), { detail: d.detail ?? "" }));

  async function start() {
    setOpen(true);
    setError(null);
    setSaved(false);
    setRows(null);
    const res = await fetch(`/api/listings/${encodeURIComponent(listingId)}/variants`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return showError(data);
    setCurrency(data.currency);
    setRows((data.variants as VariantEditorRow[]).map((v) => ({ ...v, priceText: v.price.toFixed(2) })));
    setMain((data.variants as VariantEditorRow[]).find((v) => v.main)?.id ?? null);
  }

  async function save() {
    if (!rows) return;
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/listings/${encodeURIComponent(listingId)}/variants`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mainVariantId: main ?? undefined, variants: rows.map((r) => ({ id: r.id, price: Number(r.priceText.replace(",", ".")), quantity: r.quantity })) }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return showError(data);
    setSaved(true);
    router.refresh();
  }

  const set = (id: string, patch: Partial<Row>) => setRows((rs) => rs && rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  return (
    <>
      <button type="button" onClick={start} className="font-medium text-brand-300 hover:text-brand-200">{t.edit}</button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-3" role="dialog" aria-label={t.title}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-fg">{t.title}</h2>
                <p className="mt-1 text-sm text-muted">{t.help}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-md px-2 py-1 text-sm text-muted hover:bg-surface-2 hover:text-fg" aria-label={t.close}>✕</button>
            </div>

            {!rows && !error && <p className="mt-4 text-sm text-muted">{t.loading}</p>}
            {rows && (
              <div className="mt-4 overflow-x-auto rounded-xl border border-line">
                <table className="w-full min-w-[520px] text-left text-sm">
                  <thead className="border-b border-line text-xs text-subtle">
                    <tr>
                      <th className="px-3 py-2 font-medium">{tl.variantCol}</th>
                      <th className="px-3 py-2 font-medium">{fmt(tl.price, { currency })}</th>
                      <th className="px-3 py-2 font-medium">{tl.quantity}</th>
                      <th className="px-3 py-2 text-center font-medium" title={tl.variantMainHelp}>{tl.variantMain}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rows.map((r) => (
                      <tr key={r.id} className={r.status === "PAUSED" ? "opacity-60" : ""}>
                        <td className="px-3 py-2">
                          <span className="flex items-center gap-2">
                            {r.image && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={r.image} alt="" className="h-9 w-9 shrink-0 rounded bg-white object-contain" />
                            )}
                            <span className="text-fg-2">{Object.values(r.options).join(" · ") || r.label}{r.status === "PAUSED" && <span className="ml-1 text-xs text-amber-300">({t.paused})</span>}</span>
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <input inputMode="decimal" value={r.priceText} onChange={(e) => set(r.id, { priceText: e.target.value })} className="input w-24 py-1 text-sm tabular-nums" aria-label={`${tl.variantCol} ${r.label}`} />
                          {r.minPrice !== null && <span className="mt-0.5 block text-[11px] text-subtle">{fmt(tl.variantMin, { min: `${r.minPrice.toFixed(2)} ${currency}` })}</span>}
                        </td>
                        <td className="px-3 py-2">
                          <input type="number" min={1} max={10} value={r.quantity} onChange={(e) => set(r.id, { quantity: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })} className="input w-16 py-1 text-sm" aria-label={tl.quantity} />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <input type="radio" name={`main-${listingId}`} checked={main === r.id} onChange={() => setMain(r.id)} aria-label={`${tl.variantMain} : ${r.label}`} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-subtle">{t.note}</p>
            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
            {saved && <p className="mt-3 text-sm text-emerald-300">{t.saved}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="btn-secondary px-4 py-2 text-sm">{t.close}</button>
              <button type="button" onClick={save} disabled={!rows || saving} className="btn-primary px-4 py-2 text-sm">{saving ? t.saving : t.save}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
