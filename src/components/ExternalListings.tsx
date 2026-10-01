"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fmt, type Dict } from "@/lib/i18n";
import { errorMessage } from "@/lib/i18n/errors";
import { ebayItemUrl } from "@/lib/listing";
import { marketplace, type MarketplaceId } from "@/lib/marketplaces";
import { Icon } from "@/components/icons";

export interface ExternalRow {
  id: string;
  itemId: string;
  title: string;
  price: number;
  quantity: number;
  image: string | null;
  hasVariations: boolean;
  marketId: MarketplaceId;
  managed: boolean;
}

interface Preview {
  supplier: "CJ" | "ALIEXPRESS";
  productId: string;
  title: string;
  image: string | null;
  marketId: MarketplaceId;
  listingPrice: number;
  variants: { id: string; label: string; price: number; stock: number }[];
  selected: {
    variantId: string; stock: number; available: boolean; cost: number | null; profit: number | null;
    marginPct: number | null; deliveryDaysMax: number | null; belowMinMargin: boolean;
  } | null;
}

const AUTO_SYNC_MS = 6 * 3600_000;

async function post(url: string, body?: unknown, method = "POST") {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }).catch(() => null);
  const data = res ? await res.json().catch(() => ({})) : {};
  return { ok: Boolean(res?.ok), data: data as Record<string, unknown> };
}

/** Panneau de liaison d'une annonce à un produit fournisseur (aperçu de la marge, puis confirmation). */
function LinkPanel({ row, t, errors, minMargin, hasAe, onDone, onCancel }: {
  row: ExternalRow; t: Dict["external"]; errors: Dict["errors"]; minMargin: number; hasAe: boolean; onDone: () => void; onCancel: () => void;
}) {
  const [supplier, setSupplier] = useState<"CJ" | "ALIEXPRESS">("CJ");
  const [input, setInput] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sym = marketplace(row.marketId).symbol;
  const money = (v: number | null) => (v === null ? "—" : `${v.toFixed(2)} ${sym}`);

  async function load(variantId?: string) {
    setBusy(true);
    setError(null);
    const r = await post(`/api/external-listings/${row.id}/preview`, { input, supplier, variantId });
    setBusy(false);
    if (!r.ok) { setPreview(null); return setError(errorMessage(errors, r.data.error)); }
    setPreview(r.data as unknown as Preview);
  }

  async function link() {
    if (!preview?.selected) return;
    setBusy(true);
    setError(null);
    const r = await post(`/api/external-listings/${row.id}/link`, { supplier: preview.supplier, productId: preview.productId, variantId: preview.selected.variantId });
    setBusy(false);
    if (!r.ok) return setError(errorMessage(errors, r.data.error));
    onDone();
  }

  const s = preview?.selected;
  return (
    <div className="mt-3 space-y-3 rounded-xl border border-line bg-surface-2/60 p-4">
      <p className="text-xs text-muted">{t.linkHelp}</p>
      <form onSubmit={(e) => { e.preventDefault(); if (input.trim()) load(); }} className="flex flex-wrap gap-2">
        {hasAe && (
          <select value={supplier} onChange={(e) => setSupplier(e.target.value as "CJ" | "ALIEXPRESS")} className="input w-auto py-2" aria-label={t.supplier}>
            <option value="CJ">CJ</option>
            <option value="ALIEXPRESS">AliExpress</option>
          </select>
        )}
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={t.inputPlaceholder} aria-label={t.inputPlaceholder} className="input min-w-0 flex-1 py-2" />
        <button disabled={busy || !input.trim()} className="btn-secondary px-4 py-2 text-sm">{busy && !preview ? t.searching : t.find}</button>
      </form>

      {preview && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            {preview.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.image} alt="" className="h-12 w-12 shrink-0 rounded-lg bg-white object-contain" />
            )}
            <p className="line-clamp-2 text-sm font-medium text-fg">{preview.title}</p>
          </div>
          {preview.variants.length > 1 && (
            <label className="block text-xs text-muted">
              {t.variant}
              <select value={s?.variantId ?? ""} onChange={(e) => load(e.target.value)} disabled={busy} className="input mt-1 py-2">
                {preview.variants.map((v) => (
                  <option key={v.id} value={v.id}>{fmt(t.variantOption, { label: v.label, price: v.price.toFixed(2), stock: v.stock })}</option>
                ))}
              </select>
            </label>
          )}
          {s ? (
            <>
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line text-xs sm:grid-cols-4">
                {([
                  [t.yourPrice, money(preview.listingPrice)],
                  [t.cost, money(s.cost)],
                  [t.profit, money(s.profit)],
                  [t.margin, s.marginPct === null ? "—" : `${s.marginPct} %`],
                ] as const).map(([k, v]) => (
                  <div key={k} className="bg-surface px-3 py-2"><dt className="text-subtle">{k}</dt><dd className="mt-0.5 font-medium text-fg-2 tabular-nums">{v}</dd></div>
                ))}
              </dl>
              <p className="text-xs text-muted">
                {fmt(t.stockLine, { stock: s.stock })}{s.deliveryDaysMax !== null ? ` · ${fmt(t.deliveryLine, { days: s.deliveryDaysMax })}` : ""}
              </p>
              {!s.available && <p className="text-xs text-amber-300">{t.warnUnavailable}</p>}
              {s.available && s.belowMinMargin && <p className="text-xs text-amber-300">{fmt(t.warnMargin, { margin: minMargin })}</p>}
              <ul className="space-y-1 text-xs text-muted">
                {[t.what1, t.what2, t.what3].map((w) => <li key={w} className="flex gap-2"><Icon name="check" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />{w}</li>)}
              </ul>
              <div className="flex flex-wrap gap-2">
                <button onClick={link} disabled={busy} className="btn-primary px-4 py-2 text-sm">{busy ? t.linking : t.confirm}</button>
                <button onClick={onCancel} className="btn-ghost px-4 py-2 text-sm">{t.cancel}</button>
              </div>
            </>
          ) : (
            <p className="text-xs text-amber-300">{t.variantGone}</p>
          )}
        </div>
      )}
      {!preview && <button onClick={onCancel} className="btn-ghost px-3 py-1.5 text-xs">{t.cancel}</button>}
      {error && <p className="text-xs text-red-300" role="alert">{error}</p>}
    </div>
  );
}

/** Annonces eBay créées en dehors de Sellvela : détection, liaison à un produit fournisseur, fin de gestion. */
export default function ExternalListings({ rows, lastSync, t, errors, locale, minMargin, hasPlan, hasEbay, hasAe }: {
  rows: ExternalRow[];
  lastSync: string | null;
  t: Dict["external"];
  errors: Dict["errors"];
  locale: string;
  minMargin: number;
  hasPlan: boolean;
  hasEbay: boolean;
  hasAe: boolean;
}) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const autoDone = useRef(false);

  const sync = useCallback(async (auto: boolean) => {
    setSyncing(true);
    if (!auto) { setError(null); setNotice(null); }
    const r = await post("/api/external-listings/sync", { auto });
    setSyncing(false);
    if (!r.ok) { if (!auto) setError(errorMessage(errors, r.data.error)); return; }
    if (!r.data.skipped) {
      if (!auto) setNotice(fmt(t.synced, { n: Number(r.data.found ?? 0) }));
      router.refresh();
    }
  }, [errors, router, t.synced]);

  // Première visite, ou dernière lecture de plus de 6 h : relecture automatique.
  useEffect(() => {
    if (autoDone.current || !hasEbay) return;
    autoDone.current = true;
    if (!lastSync || Date.now() - new Date(lastSync).getTime() > AUTO_SYNC_MS) sync(true);
  }, [hasEbay, lastSync, sync]);

  async function unlink(row: ExternalRow) {
    setBusyId(row.id);
    setError(null);
    const r = await post(`/api/external-listings/${row.id}/link`, undefined, "DELETE");
    setBusyId(null);
    if (!r.ok) return setError(errorMessage(errors, r.data.error));
    router.refresh();
  }

  const sorted = [...rows].sort((a, b) => Number(a.managed) - Number(b.managed));
  const toLink = rows.filter((r) => !r.managed && !r.hasVariations).length;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-fg">{t.title}</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">{t.subtitle}</p>
          {lastSync && <p className="mt-1 text-xs text-subtle">{fmt(t.lastSync, { date: new Date(lastSync).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" }) })}</p>}
        </div>
        {hasEbay && (
          <button onClick={() => sync(false)} disabled={syncing} className="btn-secondary px-4 py-2 text-sm">
            <Icon name="refresh" className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />{syncing ? t.syncing : t.sync}
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-300" role="alert">{error}</p>}
      {notice && <p className="text-sm text-emerald-300" role="status">{notice}</p>}
      {!hasPlan && rows.length > 0 && <p className="text-sm text-amber-300">{t.planRequired}</p>}

      {!hasEbay ? (
        <p className="rounded-2xl border border-dashed border-line-strong bg-surface/50 p-6 text-center text-sm text-muted">{t.noEbay}</p>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line-strong bg-surface/50 p-6 text-center text-sm text-muted">{syncing ? t.syncing : t.empty}</p>
      ) : (
        <>
          {toLink > 0 && <p className="text-sm text-fg-2">{fmt(t.toLink, { n: toLink })}</p>}
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {sorted.map((r) => {
              const m = marketplace(r.marketId);
              return (
                <li key={r.id} className="p-4">
                  <div className="flex gap-3">
                    {r.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.image} alt="" className="h-14 w-14 shrink-0 rounded-lg bg-white object-contain" loading="lazy" />
                    ) : (
                      <span className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-surface-2 text-subtle"><Icon name="tag" /></span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm font-medium text-fg">{r.title}</p>
                      <p className="mt-1 text-xs text-muted tabular-nums">
                        {r.price.toFixed(2)} {m.symbol} · {fmt(t.qty, { n: r.quantity })} · {m.country}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        {r.managed ? (
                          <>
                            <span className="badge bg-emerald-500/15 text-emerald-300"><Icon name="check" className="h-3 w-3" strokeWidth={3} />{t.managed}</span>
                            <button onClick={() => unlink(r)} disabled={busyId === r.id} className="font-medium text-muted hover:text-red-300">{t.unlink}</button>
                          </>
                        ) : r.hasVariations ? (
                          <span className="text-subtle">{t.variations}</span>
                        ) : hasPlan && open !== r.id ? (
                          <button onClick={() => setOpen(r.id)} className="btn-primary px-3 py-1.5 text-xs">{t.link}</button>
                        ) : null}
                        <a href={ebayItemUrl(r.marketId, r.itemId)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-300 hover:text-brand-200">
                          {t.view}<Icon name="external" className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    </div>
                  </div>
                  {open === r.id && !r.managed && (
                    <LinkPanel row={r} t={t} errors={errors} minMargin={minMargin} hasAe={hasAe} onCancel={() => setOpen(null)} onDone={() => { setOpen(null); router.refresh(); }} />
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-subtle">{t.unlinkNote}</p>
        </>
      )}
    </section>
  );
}
