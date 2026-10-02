"use client";
import { useEffect, useRef, useState } from "react";
import { SHOW_SALES_DATA } from "@/lib/flags";
import { fmt, type Dict } from "@/lib/i18n";
import { errorMessage } from "@/lib/i18n/errors";
import type { MarketplaceId } from "@/lib/marketplaces";
import ListingEditor from "@/components/ListingEditor";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/ui";

interface Result {
  marketId: MarketplaceId;
  symbol: string;
  currency: string;
  feesVerified: boolean;
  verdict: keyof Dict["finder"]["verdict"];
  keyword: string;
  marketPrice: number | null;
  ebayListingsCount: number;
  offersChecked: number;
  unitsSold: number;
  priceSource: "SOLD_WEIGHTED" | "ACTIVE_LISTINGS";
  best: { supplier: "CJ" | "ALIEXPRESS"; productId: string; variantId?: string; title: string; price: number; shipping: number; deliveryDaysMax: number; stockUs: number } | null;
  margin: { landedCost: number; fees: number; profit: number; marginPct: number } | null;
  minPriceForTarget: number | null;
  insights?: { monthlySales?: number | null };
}

export default function FinderClient({
  t, tl, markets, errors, marketIds, defaultMarket, accounts, hasGpsr, aeConnected, initialKeyword,
}: {
  aeConnected: boolean;
  initialKeyword?: string;
  t: Dict["finder"];
  tl: Dict["listing"];
  accounts: { id: string; label: string }[];
  hasGpsr: boolean;
  markets: Dict["markets"];
  errors: Dict["errors"];
  marketIds: MarketplaceId[];
  defaultMarket: MarketplaceId;
}) {
  const [r, setR] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);

  const formRef = useRef<HTMLFormElement>(null);
  // Lien AliExpress collé dans la recherche du tableau de bord : il va dans le champ dédié.
  const initialIsLink = Boolean(initialKeyword && /^https?:\/\//i.test(initialKeyword));

  useEffect(() => {
    if (initialKeyword && !initialIsLink && formRef.current) run(new FormData(formRef.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function search(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    run(new FormData(e.currentTarget));
  }

  async function run(form: FormData) {
    setLoading(true);
    setError(null);
    setEditing(false);
    const res = await fetch("/api/finder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: form.get("keyword"), marketId: form.get("marketId"), aeProduct: (form.get("aeProduct") as string | null) || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) setR(data as Result);
    else { setR(null); setError(errorMessage(errors, data.error)); }
    setLoading(false);
  }

  const money = (v: number) => `${v.toFixed(2)} ${r?.symbol ?? ""}`;

  return (
    <div className="space-y-6">
      <PageHeader title={t.title} subtitle={t.subtitle} />
      <form ref={formRef} onSubmit={search} className="card space-y-4">
        <div className="flex flex-col gap-2 lg:flex-row">
          <div className="relative flex-1">
            <Icon name="search" className="pointer-events-none absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2 text-subtle" />
            <input name="keyword" required minLength={2} defaultValue={initialIsLink ? "" : initialKeyword} autoFocus={initialIsLink} placeholder={t.placeholder} className="input h-12 pl-12 text-[15px]" />
          </div>
          <select name="marketId" defaultValue={defaultMarket} className="input h-12 lg:w-56">
            {marketIds.map((id) => <option key={id} value={id}>{markets[id]}</option>)}
          </select>
          <button disabled={loading} className="btn-primary h-12 px-6">
            {loading ? t.analyzing : t.analyze}
            {!loading && <Icon name="arrowRight" className="h-4 w-4" />}
          </button>
        </div>
        {aeConnected && (
          <label className="block text-sm">
            <span className="font-medium text-fg-2">{t.aeLabel}</span>
            <input name="aeProduct" type="text" inputMode="url" defaultValue={initialIsLink ? initialKeyword : undefined} placeholder={t.aePlaceholder} className="input mt-1.5 py-2" />
            <span className="mt-1.5 block text-xs text-subtle">{t.aeHint}</span>
          </label>
        )}
      </form>
      {loading && (
        <div className="card flex items-center gap-3 text-sm text-muted">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-400 border-t-transparent" aria-hidden="true" />
          {t.analyzing}
        </div>
      )}
      {error && <p className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>}
      {r && !loading && (
        <div className="card overflow-hidden p-0">
          <div className={`flex flex-wrap items-center justify-between gap-4 border-b border-line px-6 py-5 ${r.verdict === "RENTABLE" ? "bg-emerald-500/[0.06]" : "bg-amber-500/[0.06]"}`}>
            <div className="flex items-center gap-3">
              <span className={`grid h-10 w-10 place-items-center rounded-xl ${r.verdict === "RENTABLE" ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>
                <Icon name={r.verdict === "RENTABLE" ? "check" : "alert"} className="h-5 w-5" />
              </span>
              <div>
                <p className={`text-lg font-semibold ${r.verdict === "RENTABLE" ? "text-emerald-300" : "text-amber-300"}`}>{t.verdict[r.verdict]}</p>
                <p className="text-xs text-subtle">{r.keyword} · {markets[r.marketId]}</p>
              </div>
            </div>
            {r.margin && (
              <div className="text-right">
                <p className="eyebrow">{t.profit}</p>
                <p className={`text-2xl font-semibold tabular-nums ${r.margin.profit < 0 ? "text-red-300" : "text-emerald-300"}`}>
                  {money(r.margin.profit)} <span className="text-base text-muted">· {r.margin.marginPct} %</span>
                </p>
              </div>
            )}
          </div>
          <dl className="grid gap-px bg-line text-sm sm:grid-cols-2 lg:grid-cols-3">
            <Row k={r.priceSource === "SOLD_WEIGHTED" ? t.marketPriceSold : t.marketPriceActive} v={r.marketPrice !== null ? money(r.marketPrice) : "—"} />
            <Row k={t.listingsFound} v={r.ebayListingsCount} />
            {SHOW_SALES_DATA && <Row k={t.estSales} v={r.unitsSold} />}
            {SHOW_SALES_DATA && r.insights?.monthlySales != null && <Row k={t.monthlySales} v={r.insights.monthlySales} />}
            <Row k={t.offersCompared} v={r.offersChecked} />
            {r.best && <Row k={t.bestSupplier} v={`${r.best.supplier} — ${r.best.title}`} />}
            {r.best && <Row k={t.deliveryLabel} v={fmt(t.delivery, { days: r.best.deliveryDaysMax, stock: r.best.stockUs })} />}
            {r.margin && <Row k={t.landedCost} v={money(r.margin.landedCost)} />}
            {r.margin && <Row k={t.fees} v={money(r.margin.fees)} />}
            {r.minPriceForTarget !== null && <Row k={t.minPrice} v={money(r.minPriceForTarget)} />}
          </dl>
          <div className="space-y-3 px-6 py-5">
            {!r.feesVerified && <p className="rounded-lg bg-amber-500/10 p-2.5 text-xs text-amber-200">{t.feesUnverified}</p>}
            <p className="text-xs text-subtle">{t.sourceNote}</p>
            {r.verdict === "RENTABLE" && r.best && !editing && (
              <button type="button" onClick={() => setEditing(true)} className="btn-primary">{tl.create}</button>
            )}
          </div>
        </div>
      )}
      {r && editing && r.best && (
        <ListingEditor
          t={tl}
          errors={errors}
          markets={markets}
          accounts={accounts}
          hasGpsr={hasGpsr}
          keyword={r.keyword}
          marketId={r.marketId}
          supplierRef={{ supplier: r.best.supplier, productId: r.best.productId, variantId: r.best.variantId }}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string | number }) {
  return (<div className="bg-surface px-6 py-4"><dt className="text-xs text-subtle">{k}</dt><dd className="mt-1 font-medium text-fg">{v}</dd></div>);
}
