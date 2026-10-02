"use client";
import { useState } from "react";
import Link from "next/link";
import { fmt, type Dict } from "@/lib/i18n";
import type { RunState } from "@/lib/sniper-service";
import type { CandidateDetails } from "@/lib/sniper";
import { Icon } from "@/components/icons";
import { cjProductUrl, ebayPreciseSearchUrl, ebaySearchUrl } from "@/lib/listing";
import ComparablesPanel from "@/components/ComparablesPanel";
import type { MarketplaceId } from "@/lib/marketplaces";
import { SHOW_SALES_DATA } from "@/lib/flags";
import ProductCalculator from "@/components/ProductCalculator";

type Candidate = RunState["candidates"][number];

/** Répartition des prix des concurrents (un point par annonce), avec le prix du marché, notre prix minimum et notre coût. */
function PriceChart({ t, prices, market, minPrice, cost, money }: {
  t: Dict["sniper"]["card"];
  prices: number[];
  market: number | null;
  minPrice: number | null;
  cost: number | null;
  money: (v: number | null) => string;
}) {
  const refs = [market, minPrice, cost].filter((v): v is number => v !== null && v > 0);
  const all = [...prices, ...refs];
  if (!prices.length || !all.length) return null;
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pad = (hi - lo) * 0.06 || hi * 0.1 || 1;
  const min = Math.max(0, lo - pad);
  const max = hi + pad;
  const W = 320;
  const H = 96;
  const AXIS = 72;
  const x = (v: number) => 8 + ((v - min) / (max - min)) * (W - 16);
  // Points empilés quand plusieurs annonces ont presque le même prix (graphique en points).
  const bins = new Map<number, number>();
  const dots = prices.map((p) => {
    const b = Math.round(x(p) / 9);
    const n = bins.get(b) ?? 0;
    bins.set(b, n + 1);
    return { p, cx: x(p), cy: AXIS - 7 - Math.min(n, 5) * 9 };
  });
  const line = (v: number | null, cls: string, dash: string | undefined, label: string) =>
    v !== null && v > 0 ? (
      <line x1={x(v)} x2={x(v)} y1={10} y2={AXIS} className={cls} strokeWidth={2} strokeDasharray={dash}>
        <title>{`${label} : ${money(v)}`}</title>
      </line>
    ) : null;

  return (
    <figure className="min-w-0">
      <figcaption className="text-xs font-medium text-muted">{t.chartTitle}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img" aria-label={t.chartTitle}>
        <line x1={8} x2={W - 8} y1={AXIS} y2={AXIS} className="stroke-line-strong" strokeWidth={1} />
        {line(cost, "stroke-subtle", "2 3", t.chartCost)}
        {line(minPrice, "stroke-amber-300", "5 4", t.chartMin)}
        {dots.map((d, i) => (
          <circle key={i} cx={d.cx} cy={d.cy} r={4} className="fill-brand-400 stroke-surface" strokeWidth={2}>
            <title>{money(d.p)}</title>
          </circle>
        ))}
        {line(market, "stroke-fg", undefined, t.chartMarket)}
        <text x={8} y={H - 6} className="fill-subtle text-[10px]">{money(min)}</text>
        <text x={W - 8} y={H - 6} textAnchor="end" className="fill-subtle text-[10px]">{money(max)}</text>
      </svg>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
        <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-brand-400" />{t.chartCompetitors}</li>
        {market !== null && <li className="flex items-center gap-1.5"><span className="h-3 w-0.5 bg-fg" />{t.chartMarket}</li>}
        {minPrice !== null && <li className="flex items-center gap-1.5"><span className="h-3 w-0.5 border-l-2 border-dashed border-amber-300" />{t.chartMin}</li>}
        {cost !== null && <li className="flex items-center gap-1.5"><span className="h-3 w-0.5 border-l-2 border-dotted border-subtle" />{t.chartCost}</li>}
      </ul>
    </figure>
  );
}

export default function SniperProductCard({ c, t, minMargin, money, reason, onCreate, collapsible, marketId, saved, onToggleSave }: {
  c: Candidate;
  t: Dict["sniper"];
  minMargin: number;
  money: (v: number | null) => string;
  reason: string | null;
  onCreate: (c: Candidate) => void;
  collapsible?: boolean;
  marketId: MarketplaceId;
  /** Produit déjà sauvegardé (bouton marque-page plein). */
  saved?: boolean;
  onToggleSave?: (c: Candidate) => void;
}) {
  const [open, setOpen] = useState(!collapsible);
  const [calc, setCalc] = useState(false);
  const k = t.card;
  const d: CandidateDetails = c.details ?? {};
  const m = d.market;
  const good = c.status === "PROFITABLE" || c.status === "LISTED";
  const marginTone = c.marginPct === null ? "text-muted" : c.marginPct >= minMargin ? "text-emerald-300" : "text-amber-300";
  const num = (v: number | null | undefined, suffix = "") => (v === null || v === undefined ? "—" : `${v.toLocaleString("en-US", { maximumFractionDigits: 1 })}${suffix}`);

  const breakdown: [string, string, string?][] = [
    [k.ebayPrice, c.marketPrice ? money(c.marketPrice) : "—"],
    [k.fees, d.fees !== null && d.fees !== undefined ? `− ${money(d.fees)}` : "—"],
    [k.supplierPrice, d.supplierPrice !== null && d.supplierPrice !== undefined ? `− ${money(d.supplierPrice)}` : "—"],
    [k.shipping, d.shipping === 0 ? k.free : d.shipping !== null && d.shipping !== undefined ? `− ${money(d.shipping)}` : "—"],
    [k.profit, c.profit !== null ? money(c.profit) : "—", "font-semibold text-fg"],
  ];
  const stats: [string, string][] = [
    ...(SHOW_SALES_DATA && !c.expired && m?.monthlySales != null ? ([[k.monthly, fmt(k.perMonth, { n: m.monthlySales })]] as [string, string][]) : []),
    ...(SHOW_SALES_DATA && !c.expired ? ([[k.estSales, num(c.unitsSold)]] as [string, string][]) : []),
    [k.competitors, num(m?.listings)],
    [k.priceRange, m?.priceMin !== null && m?.priceMin !== undefined ? `${money(m.priceMin)} – ${money(m.priceMax ?? null)}` : "—"],
    [fmt(k.minPrice, { margin: minMargin }), money(d.minPrice ?? null)],
    [k.totalCost, money(c.cost)],
    [k.stock, num(d.stock)],
    [k.delivery, c.deliveryDaysMax ? fmt(t.days, { days: c.deliveryDaysMax }) : "—"],
  ];

  return (
    <article className="card relative flex min-w-0 flex-col p-0">
      {onToggleSave && c.productId && c.supplier && (
        <button
          type="button"
          onClick={() => onToggleSave(c)}
          aria-pressed={Boolean(saved)}
          aria-label={saved ? k.unsave : k.save}
          title={saved ? k.unsave : k.save}
          className={`absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-lg border transition ${saved ? "border-brand-500/50 bg-brand-500/15 text-brand-300" : "border-line bg-surface-2 text-subtle hover:border-brand-500/50 hover:text-fg"}`}
        >
          <Icon name="bookmark" className="h-4 w-4" filled={Boolean(saved)} />
        </button>
      )}
      <div className="flex gap-4 p-5">
        {c.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.image} alt="" className="h-20 w-20 shrink-0 rounded-xl bg-white object-contain" loading="lazy" />
        ) : (
          <span className="grid h-20 w-20 shrink-0 place-items-center rounded-xl bg-surface-2 text-subtle"><Icon name="box" /></span>
        )}
        <div className={`min-w-0 flex-1 ${onToggleSave ? "pr-8" : ""}`}>
          <p className="line-clamp-2 text-sm font-medium text-fg" title={c.title ?? c.keyword}>{c.title ?? c.keyword}</p>
          <p className="mt-1 truncate text-xs text-subtle">{fmt(t.search, { keyword: c.keyword })}</p>
          {c.expired && <p className="mt-1 text-xs text-amber-300">{k.expired}</p>}
          <p className="mt-2 flex flex-wrap items-baseline gap-x-2 tabular-nums">
            <span className={`text-xl font-semibold ${c.profit !== null && c.profit > 0 ? marginTone : "text-muted"}`}>
              {c.profit !== null ? `${c.profit > 0 ? "+" : ""}${money(c.profit)}` : "—"}
            </span>
            <span className={`text-sm font-medium ${marginTone}`}>{c.marginPct !== null ? `${c.marginPct} % ${k.margin}` : ""}</span>
          </p>
          {SHOW_SALES_DATA && !c.expired && (
            <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted tabular-nums" title={k.estSalesHint}>
              <span className="inline-flex items-center gap-1"><Icon name="fire" className="h-3.5 w-3.5 text-amber-300" />{m?.monthlySales != null ? fmt(k.perMonthSales, { n: m.monthlySales }) : fmt(k.estSalesValue, { n: c.unitsSold ?? 0 })}</span>
              <span className="inline-flex items-center gap-1"><Icon name="users" className="h-3.5 w-3.5 text-subtle" />{fmt(k.competitorsValue, { n: m?.listings ?? 0 })}</span>
            </p>
          )}
          {reason && <p className="mt-1.5 text-xs"><span className="inline-block rounded-md bg-surface-3 px-2 py-0.5 font-medium leading-snug text-muted">{reason}</span></p>}
          <p className="mt-2 flex flex-wrap gap-2 text-xs">
            <a href={m?.search ? ebayPreciseSearchUrl(marketId, m.search) : ebaySearchUrl(marketId, c.keyword)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface-2 px-2.5 py-1 font-medium text-fg-2 hover:border-brand-500/50 hover:text-fg">
              {k.viewEbay} <span aria-hidden="true">↗</span>
            </a>
            <button type="button" onClick={() => setCalc((v) => !v)} aria-expanded={calc}
              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 font-medium transition ${calc ? "border-brand-500/50 bg-brand-500/15 text-fg" : "border-line bg-surface-2 text-fg-2 hover:border-brand-500/50 hover:text-fg"}`}>
              <Icon name="dollar" className="h-3.5 w-3.5" />{t.calc.open}
            </button>
            {c.supplier === "CJ" && c.productId && (
              <a href={cjProductUrl(c.productId, c.title)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface-2 px-2.5 py-1 font-medium text-fg-2 hover:border-brand-500/50 hover:text-fg">
                {k.viewCj} <span aria-hidden="true">↗</span>
              </a>
            )}
          </p>
        </div>
      </div>

      {calc && (
        <div className="px-5 pb-4">
          <ProductCalculator
            t={t.calc}
            marketId={marketId}
            price={c.expired ? null : c.marketPrice ?? d.minPrice ?? null}
            cost={d.supplierPrice ?? null}
            shipping={d.shipping ?? null}
            minMargin={minMargin}
          />
        </div>
      )}

      {collapsible && (
        <button onClick={() => setOpen((o) => !o)} className="mx-5 mb-3 self-start text-xs font-medium text-brand-300 hover:text-brand-200" aria-expanded={open}>
          {open ? k.hide : k.details}
        </button>
      )}

      {open && (
        <div className="space-y-4 border-t border-line p-5">
          {/* Du prix eBay au bénéfice */}
          <dl className="space-y-1.5 text-sm">
            {breakdown.map(([label, value, cls]) => (
              <div key={label} className={`flex justify-between gap-3 ${cls ? "border-t border-line pt-1.5" : ""}`}>
                <dt className={cls ?? "text-muted"}>{label}</dt>
                <dd className={`tabular-nums ${cls ?? "text-fg-2"}`}>{value}</dd>
              </div>
            ))}
          </dl>

          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line text-xs">
            {stats.map(([label, value]) => (
              <div key={label} className="min-w-0 bg-surface px-3 py-2">
                <dt className="leading-tight text-subtle">{label}</dt>
                <dd className="mt-0.5 truncate font-medium text-fg-2 tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>

          {m && m.prices.length > 0 ? (
            <PriceChart t={k} prices={m.prices} market={c.marketPrice} minPrice={d.minPrice ?? null} cost={c.cost ?? (d.supplierPrice ?? null)} money={money} />
          ) : (
            <p className="text-xs text-subtle">{k.noMarket}</p>
          )}

          {c.image && !c.expired && <ComparablesPanel t={k} image={c.image} keyword={c.keyword} marketId={marketId} money={money} />}

          <p className="text-[11px] text-subtle">{m?.method === "IMAGE" ? `${k.byImage} ` : ""}{k.estimateNote}</p>
        </div>
      )}

      {good && (
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-line p-4">
          {c.status === "LISTED" ? (
            <>
              <span className="badge bg-emerald-500/15 text-emerald-300"><Icon name="check" className="h-3 w-3" strokeWidth={3} />{t.listed}</span>
              <Link href="/listings" className="text-sm font-medium text-brand-300 hover:text-brand-200">{t.viewListings}</Link>
            </>
          ) : (
            <>
              <span />
              <button onClick={() => onCreate(c)} disabled={!c.productId || !c.supplier} className="btn-primary shrink-0 px-4 py-2 text-sm">{t.create}</button>
            </>
          )}
        </div>
      )}
    </article>
  );
}
