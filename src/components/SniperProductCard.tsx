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

/** Graduations « rondes » (1, 2, 2.5, 5 × 10^n) entre min et max. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min;
  if (!(span > 0)) return [min];
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((st) => st >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

/** Classes de prix (histogramme) : bornes et nombre d'annonces dans chacune. */
export function priceBins(prices: number[], min: number, max: number, n: number): { from: number; to: number; count: number }[] {
  const w = (max - min) / n || 1;
  const bins = Array.from({ length: n }, (_, i) => ({ from: min + i * w, to: min + (i + 1) * w, count: 0 }));
  for (const p of prices) bins[Math.min(n - 1, Math.max(0, Math.floor((p - min) / w)))].count++;
  return bins;
}

/**
 * Prix des concurrents (histogramme) : combien d'annonces à chaque niveau de prix, avec ton coût, ton prix
 * minimum (zone rentable au-dessus) et le prix du marché. Les classes au-dessus de ton prix minimum sont
 * en couleur : ce sont les prix auxquels tu peux te placer en gardant ta marge.
 */
function PriceChart({ t, prices, market, minPrice, cost, money }: {
  t: Dict["sniper"]["card"];
  prices: number[];
  market: number | null;
  minPrice: number | null;
  cost: number | null;
  money: (v: number | null) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const valid = prices.filter((p) => p > 0);
  const refs = [market, minPrice, cost].filter((v): v is number => v !== null && v > 0);
  if (!valid.length) return null;
  const lo = Math.min(...valid, ...refs);
  const hi = Math.max(...valid, ...refs);
  const ticks = niceTicks(Math.max(0, lo - (hi - lo) * 0.05), hi + (hi - lo) * 0.05);
  const min = Math.min(ticks[0], lo);
  const max = Math.max(ticks[ticks.length - 1], hi) || 1;
  const N = Math.min(14, Math.max(6, Math.round(Math.sqrt(valid.length) * 2)));
  const bins = priceBins(valid, min, max === min ? min + 1 : max, N);
  const top = Math.max(...bins.map((b) => b.count));

  const W = 340, H = 150, L = 8, R = 8, T = 22, B = 22;
  const plotW = W - L - R, plotH = H - T - B;
  const x = (v: number) => L + ((v - min) / (max - min || 1)) * plotW;
  const y = (n: number) => T + plotH - (n / top) * plotH;
  const base = T + plotH;
  const above = minPrice !== null ? valid.filter((p) => p >= minPrice).length : null;
  const pct = above !== null ? Math.round((above / valid.length) * 100) : null;
  const h = hover !== null ? bins[hover] : null;

  return (
    <figure className="min-w-0 rounded-xl border border-line bg-surface-2/40 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <figcaption className="text-xs font-semibold text-fg-2">{t.chartTitle}</figcaption>
        <span className="text-[11px] text-subtle">{fmt(t.chartCount, { n: valid.length })}</span>
      </div>

      {/* Les 3 repères, en chiffres */}
      <dl className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
        {([
          [t.chartCost, cost, "bg-subtle"],
          [t.chartMin, minPrice, "bg-amber-300"],
          [t.chartMarket, market, "bg-fg"],
        ] as const).map(([label, v, sw]) => (
          <div key={label} className="min-w-0 rounded-lg bg-surface px-2 py-1.5">
            <dt className="flex items-center gap-1.5 truncate text-subtle"><span className={`h-2.5 w-0.5 shrink-0 rounded ${sw}`} />{label}</dt>
            <dd className="mt-0.5 font-semibold tabular-nums text-fg">{v !== null && v > 0 ? money(v) : "—"}</dd>
          </div>
        ))}
      </dl>

      {/* Détail de la classe survolée */}
      <p className="mt-2 h-4 text-[11px] tabular-nums text-fg-2" aria-live="polite">
        {h ? fmt(t.chartBin, { from: money(h.from), to: money(h.to), n: h.count }) : t.chartHint}
      </p>

      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full" role="img" aria-label={t.chartTitle} onMouseLeave={() => setHover(null)}>
        {/* Zone rentable : au-dessus de ton prix minimum */}
        {minPrice !== null && minPrice > 0 && minPrice < max && (
          <>
            <rect x={x(minPrice)} y={T} width={L + plotW - x(minPrice)} height={plotH} className="fill-emerald-400/[0.07]" />
            <text x={L + plotW - 2} y={T + 10} textAnchor="end" className="fill-emerald-300 text-[9px] font-medium">{t.chartZone}</text>
          </>
        )}
        {/* Grille horizontale discrète */}
        {[0.5, 1].map((f) => (
          <line key={f} x1={L} x2={L + plotW} y1={T + plotH * (1 - f)} y2={T + plotH * (1 - f)} className="stroke-line" strokeWidth={1} strokeDasharray="2 4" />
        ))}
        {/* Histogramme */}
        {bins.map((b, i) => {
          const bx = x(b.from) + 1;
          const bw = Math.max(1, x(b.to) - x(b.from) - 2);
          const profitable = minPrice === null || b.from + (b.to - b.from) / 2 >= minPrice;
          const hgt = b.count ? Math.max(3, base - y(b.count)) : 0;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={b.count ? 0 : -1}>
              <rect x={x(b.from)} y={T} width={x(b.to) - x(b.from)} height={plotH} fill="transparent" />
              {b.count > 0 && (
                <rect x={bx} y={base - hgt} width={bw} height={hgt} rx={3}
                  className={`${profitable ? "fill-brand-500" : "fill-subtle"} ${hover === i ? "opacity-100" : hover !== null ? "opacity-60" : ""} transition-opacity`}>
                  <title>{fmt(t.chartBin, { from: money(b.from), to: money(b.to), n: b.count })}</title>
                </rect>
              )}
              {b.count > 0 && b.count === top && !(market !== null && market > 0 && Math.abs(bx + bw / 2 - x(market)) < 34) && (
                <text x={bx + bw / 2} y={base - hgt - 3} textAnchor="middle" className="fill-muted text-[9px] tabular-nums">{b.count}</text>
              )}
            </g>
          );
        })}
        {/* Repères verticaux */}
        {cost !== null && cost > 0 && <line x1={x(cost)} x2={x(cost)} y1={T} y2={base} className="stroke-subtle" strokeWidth={1.5} strokeDasharray="2 3" />}
        {minPrice !== null && minPrice > 0 && <line x1={x(minPrice)} x2={x(minPrice)} y1={T} y2={base} className="stroke-amber-300" strokeWidth={2} strokeDasharray="5 3" />}
        {market !== null && market > 0 && (
          <>
            <line x1={x(market)} x2={x(market)} y1={T - 4} y2={base} className="stroke-fg" strokeWidth={2} />
            <text x={Math.min(Math.max(x(market), L + 30), L + plotW - 30)} y={T - 8} textAnchor="middle" className="fill-fg text-[9px] font-semibold tabular-nums">{money(market)}</text>
          </>
        )}
        {/* Axe des prix */}
        <line x1={L} x2={L + plotW} y1={base} y2={base} className="stroke-line-strong" strokeWidth={1} />
        {ticks.map((v) => (
          <text key={v} x={x(v)} y={H - 6} textAnchor={x(v) < L + 18 ? "start" : x(v) > L + plotW - 18 ? "end" : "middle"} className="fill-subtle text-[9px] tabular-nums">{money(v)}</text>
        ))}
      </svg>

      {/* Légende */}
      <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
        <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-brand-500" />{t.chartAboveMin}</li>
        {minPrice !== null && <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-subtle" />{t.chartBelowMin}</li>}
      </ul>

      {/* Conclusion en une phrase */}
      {pct !== null && (
        <p className={`mt-2 rounded-lg px-2.5 py-1.5 text-[11px] font-medium ${pct >= 50 ? "bg-emerald-500/10 text-emerald-300" : pct >= 20 ? "bg-amber-500/10 text-amber-300" : "bg-red-500/10 text-red-300"}`}>
          {fmt(t.chartVerdict, { n: above!, total: valid.length, pct: pct })}
        </p>
      )}
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
  const searchUrl = m?.search ? ebayPreciseSearchUrl(marketId, m.search) : ebaySearchUrl(marketId, c.keyword);
  /**
   * « Voir sur eBay » : l'annonce la plus proche, trouvée par la photo (le site eBay n'accepte pas de recherche
   * par image dans un lien). L'onglet est ouvert tout de suite (sinon bloqué), puis dirigé vers l'annonce ;
   * à défaut, vers la recherche précise.
   */
  async function openClosest(e: React.MouseEvent<HTMLAnchorElement>) {
    if (!c.image || c.expired || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    const win = window.open("about:blank", "_blank");
    if (!win) return void (window.location.href = searchUrl);
    win.opener = null;
    const q = new URLSearchParams({ image: c.image, kw: c.keyword, m: marketId, ...(m?.search?.cost ? { cost: String(m.search.cost) } : {}) });
    const data = await fetch(`/api/comparables?${q}`).then((r) => (r.ok ? r.json() : null)).catch(() => null) as { items?: { url: string | null }[] } | null;
    const url = data?.items?.find((i) => i.url && /^https:\/\/(www\.)?ebay\./.test(i.url))?.url;
    win.location.href = url ?? searchUrl;
  }
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
            <a href={searchUrl} target="_blank" rel="noopener noreferrer" onClick={openClosest} title={c.image && !c.expired ? k.viewEbayHint : undefined}
              className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface-2 px-2.5 py-1 font-medium text-fg-2 hover:border-brand-500/50 hover:text-fg">
              {k.viewEbay} <span aria-hidden="true">↗</span>
            </a>
            {c.image && !c.expired && (
              <a href={searchUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 font-medium text-muted hover:text-fg">
                {k.viewSearch} <span aria-hidden="true">↗</span>
              </a>
            )}
            <button type="button" onClick={() => setCalc((v) => !v)} aria-expanded={calc}
              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 font-medium transition ${calc ? "border-brand-500/50 bg-brand-500/15 text-fg" : "border-line bg-surface-2 text-fg-2 hover:border-brand-500/50 hover:text-fg"}`}>
              <Icon name="dollar" className="h-3.5 w-3.5" />{t.calc.open}
            </button>
            {c.supplier === "CJ" && c.productId && (
              <a href={cjProductUrl(c.productId, c.title)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface-2 px-2.5 py-1 font-medium text-fg-2 hover:border-brand-500/50 hover:text-fg">
                {k.viewCj} <span aria-hidden="true">↗</span>
              </a>
            )}
            {c.supplier === "ALIEXPRESS" && c.productId && /^\d{6,20}$/.test(c.productId) && (
              <a href={`https://www.aliexpress.com/item/${c.productId}.html`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface-2 px-2.5 py-1 font-medium text-fg-2 hover:border-brand-500/50 hover:text-fg">
                AliExpress <span aria-hidden="true">↗</span>
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

          {c.image && !c.expired && <ComparablesPanel t={k} image={c.image} keyword={c.keyword} marketId={marketId} cost={m?.search?.cost ?? null} money={money} />}

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
