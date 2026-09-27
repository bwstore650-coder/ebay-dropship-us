"use client";
import { useState } from "react";
import { fmt, type Dict } from "@/lib/i18n";
import { errorMessage } from "@/lib/i18n/errors";
import type { MarketplaceId } from "@/lib/marketplaces";

interface Result {
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
  best: { supplier: string; title: string; price: number; shipping: number; deliveryDaysMax: number; stockUs: number } | null;
  margin: { landedCost: number; fees: number; profit: number; marginPct: number } | null;
  minPriceForTarget: number | null;
}

export default function FinderClient({
  t, markets, errors, marketIds, defaultMarket,
}: {
  t: Dict["finder"];
  markets: Dict["markets"];
  errors: Dict["errors"];
  marketIds: MarketplaceId[];
  defaultMarket: MarketplaceId;
}) {
  const [r, setR] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function search(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/finder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: form.get("keyword"), marketId: form.get("marketId") }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) setR(data as Result);
    else { setR(null); setError(errorMessage(errors, data.error)); }
    setLoading(false);
  }

  const money = (v: number) => `${v.toFixed(2)} ${r?.symbol ?? ""}`;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t.title}</h1>
      <form onSubmit={search} className="flex flex-wrap gap-2">
        <input name="keyword" required minLength={2} placeholder={t.placeholder} className="flex-1 rounded-lg border border-slate-300 px-3 py-2" />
        <select name="marketId" defaultValue={defaultMarket} className="rounded-lg border border-slate-300 px-3 py-2">
          {marketIds.map((id) => <option key={id} value={id}>{markets[id]}</option>)}
        </select>
        <button disabled={loading} className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-60">
          {loading ? t.analyzing : t.analyze}
        </button>
      </form>
      {error && <p className="text-red-600">{error}</p>}
      {r && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <p className={`text-lg font-semibold ${r.verdict === "RENTABLE" ? "text-green-600" : "text-amber-600"}`}>{t.verdict[r.verdict]}</p>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <Row k={r.priceSource === "SOLD_WEIGHTED" ? t.marketPriceSold : t.marketPriceActive} v={r.marketPrice !== null ? money(r.marketPrice) : "—"} />
            <Row k={t.listingsFound} v={r.ebayListingsCount} />
            <Row k={t.unitsSold} v={r.unitsSold} />
            <Row k={t.offersCompared} v={r.offersChecked} />
            {r.best && <Row k={t.bestSupplier} v={`${r.best.supplier} — ${r.best.title}`} />}
            {r.best && <Row k={t.deliveryLabel} v={fmt(t.delivery, { days: r.best.deliveryDaysMax, stock: r.best.stockUs })} />}
            {r.margin && <Row k={t.landedCost} v={money(r.margin.landedCost)} />}
            {r.margin && <Row k={t.fees} v={money(r.margin.fees)} />}
            {r.margin && <Row k={t.profit} v={`${money(r.margin.profit)} (${r.margin.marginPct} %)`} />}
            {r.minPriceForTarget !== null && <Row k={t.minPrice} v={money(r.minPriceForTarget)} />}
          </dl>
          {!r.feesVerified && <p className="mt-4 rounded-lg bg-amber-50 p-2 text-xs text-amber-700">{t.feesUnverified}</p>}
          <p className="mt-4 text-xs text-slate-500">{t.sourceNote}</p>
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string | number }) {
  return (<div><dt className="text-slate-500">{k}</dt><dd className="font-medium">{v}</dd></div>);
}
