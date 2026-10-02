"use client";
import { useMemo, useState } from "react";
import { fmt, type Dict } from "@/lib/i18n";
import { quantityProfit } from "@/lib/margin";
import { marketplace, type MarketplaceId } from "@/lib/marketplaces";

const QUICK_QTY = [1, 10, 50, 100, 500];

function num(v: string): number {
  const n = parseFloat(v.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
const str = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(Math.round(v * 100) / 100));

/**
 * Calculateur d'une fiche produit : le vendeur choisit son prix de vente, le coût fournisseur (rempli
 * automatiquement, modifiable) et une quantité, et voit le bénéfice par vente et pour toutes ces ventes.
 */
export default function ProductCalculator({ t, marketId, price, cost, shipping, minMargin }: {
  t: Dict["sniper"]["calc"];
  marketId: MarketplaceId;
  price: number | null;      // prix eBay proposé (marché)
  cost: number | null;       // prix fournisseur
  shipping: number | null;   // livraison fournisseur
  minMargin: number;
}) {
  const m = marketplace(marketId);
  const [sale, setSale] = useState(str(price));
  const [supplier, setSupplier] = useState(str(cost));
  const [ship, setShip] = useState(str(shipping ?? 0));
  const [ads, setAds] = useState("0");
  const [qty, setQty] = useState("10");
  const auto = { sale: str(price), supplier: str(cost), ship: str(shipping ?? 0) };
  const edited = sale !== auto.sale || supplier !== auto.supplier || ship !== auto.ship;

  const r = useMemo(
    () => quantityProfit({ saleTotal: num(sale), supplierCost: num(supplier), supplierShipping: num(ship), promotedRate: Math.min(num(ads), 100) / 100, market: m, quantity: num(qty) }),
    [sale, supplier, ship, ads, qty, m],
  );
  const money = (v: number) => `${v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${m.symbol}`;
  const tone = r.unit.profit <= 0 ? "text-red-300" : r.unit.marginPct >= minMargin ? "text-emerald-300" : "text-amber-300";
  const ready = num(sale) > 0;

  const field = (label: string, value: string, set: (v: string) => void, suffix: string, hint?: string) => (
    <label className="block min-w-0 text-xs text-muted">
      {label}
      <span className="relative mt-1 block">
        <input inputMode="decimal" value={value} onChange={(e) => set(e.target.value)} className="input w-full py-1.5 pr-8 tabular-nums" aria-label={label} />
        <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-subtle">{suffix}</span>
      </span>
      {hint && <span className="mt-0.5 block text-[11px] text-subtle">{hint}</span>}
    </label>
  );

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface-2/50 p-3">
      <div className="grid grid-cols-2 gap-2">
        {field(t.salePrice, sale, setSale, m.symbol)}
        {field(t.supplierCost, supplier, setSupplier, m.symbol, t.autoFilled)}
        {field(t.supplierShipping, ship, setShip, m.symbol)}
        {field(t.ads, ads, setAds, "%")}
      </div>
      {edited && (
        <button type="button" onClick={() => { setSale(auto.sale); setSupplier(auto.supplier); setShip(auto.ship); }} className="text-[11px] font-medium text-brand-300 hover:text-brand-200">
          {t.reset}
        </button>
      )}

      {ready && (
        <>
          <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-line bg-line text-xs">
            <div className="bg-surface px-2.5 py-2"><dt className="text-subtle">{t.fees}</dt><dd className="mt-0.5 font-medium text-fg-2 tabular-nums">{money(r.unit.fees)}</dd></div>
            <div className="bg-surface px-2.5 py-2"><dt className="text-subtle">{t.profitPerSale}</dt><dd className={`mt-0.5 font-semibold tabular-nums ${tone}`}>{money(r.unit.profit)}</dd></div>
            <div className="bg-surface px-2.5 py-2"><dt className="text-subtle">{t.margin}</dt><dd className={`mt-0.5 font-semibold tabular-nums ${tone}`}>{r.unit.marginPct} %</dd></div>
          </dl>
          {r.breakEven !== null && <p className="text-[11px] text-subtle">{fmt(t.breakEven, { price: money(r.breakEven) })}</p>}

          <div>
            <label className="block text-xs text-muted">
              {t.quantity}
              <input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, "").slice(0, 7))} className="input mt-1 w-full py-1.5 tabular-nums" aria-label={t.quantity} />
            </label>
            <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label={t.quantity}>
              {QUICK_QTY.map((n) => (
                <button key={n} type="button" onClick={() => setQty(String(n))} aria-pressed={r.quantity === n}
                  className={`rounded-md px-2 py-0.5 text-[11px] font-medium tabular-nums transition ${r.quantity === n ? "bg-brand-500/20 text-fg ring-1 ring-brand-500/40" : "bg-surface-3 text-muted hover:text-fg"}`}>
                  {n}
                </button>
              ))}
            </div>
          </div>

          <dl className="space-y-1 rounded-lg border border-line bg-surface p-2.5 text-xs">
            {([
              [fmt(t.revenue, { n: r.quantity }), money(r.revenue)],
              [t.totalCost, `− ${money(r.cost)}`],
              [t.totalFees, `− ${money(r.fees)}`],
            ] as const).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="tabular-nums text-fg-2">{v}</dd></div>
            ))}
            <div className="flex justify-between gap-3 border-t border-line pt-1.5">
              <dt className="font-semibold text-fg">{fmt(t.totalProfit, { n: r.quantity })}</dt>
              <dd className={`text-base font-semibold tabular-nums ${tone}`}>{money(r.profit)}</dd>
            </div>
          </dl>
          <p className="text-[11px] text-subtle">{t.note}</p>
        </>
      )}
    </div>
  );
}
