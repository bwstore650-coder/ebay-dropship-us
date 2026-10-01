import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmt, LOCALE_TAGS } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { marketplace, type MarketplaceId } from "@/lib/marketplaces";
import type { OrderLine } from "@/lib/orders";
import { Icon, type IconName } from "@/components/icons";
import { Notice, StatCard, StatusBadge } from "@/components/ui";
import { ORDER_TONE } from "@/lib/status-tones";
import { change, dailySeries, ordersByMarket, topProducts, totals, type DashOrder } from "@/lib/dashboard";
import SalesChart from "@/components/SalesChart";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;
const PAUSE_REASONS = ["OUT_OF_STOCK", "MARGIN", "SLOW", "SUPPLIER_GONE"] as const;

export default async function Dashboard() {
  const user = await requireUser();
  const { locale, t } = await getI18n();
  const D = t.dashboard;
  const tag = LOCALE_TAGS[locale];
  const now = new Date();
  const end = new Date(now.getTime() + 1);
  const since = new Date(now.getTime() - 30 * DAY);
  const prevSince = new Date(now.getTime() - 60 * DAY);

  const [active, paused, drafts, orders60, recent, needsReview, openReturns, pausedList, lastRun] = await Promise.all([
    db.listing.count({ where: { userId: user.id, status: "ACTIVE" } }),
    db.listing.count({ where: { userId: user.id, status: "PAUSED" } }),
    db.listing.count({ where: { userId: user.id, status: "DRAFT" } }),
    db.order.findMany({ where: { userId: user.id, createdAt: { gte: prevSince } }, orderBy: { createdAt: "desc" } }),
    db.order.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 6 }),
    db.order.count({ where: { userId: user.id, status: { in: ["NEEDS_REVIEW", "FAILED"] } } }),
    db.afterSale.count({ where: { userId: user.id, open: true } }),
    db.listing.findMany({ where: { userId: user.id, status: "PAUSED" }, select: { pauseReason: true } }),
    db.snipeRun.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
  ]);
  const sniperTop = lastRun
    ? await db.snipeCandidate.findMany({
        where: { runId: lastRun.id, status: { in: ["PROFITABLE", "LISTED"] } },
        orderBy: { profit: "desc" },
        take: 4,
      })
    : [];

  const orders = orders60.map((o) => ({ ...o, lines: (o.lines as unknown as DashOrder["lines"]) ?? [] })) as DashOrder[];
  // Devise principale : celle qui a rapporté le plus sur 30 jours (sinon celle du pays par défaut).
  const byCur = new Map<string, number>();
  for (const o of orders) if (o.createdAt >= since && (o.status === "ORDERED" || o.status === "SHIPPED")) byCur.set(o.currency, (byCur.get(o.currency) ?? 0) + (o.saleTotal ?? 0));
  const defaultMarket = marketplace(user.defaultMarketplace);
  const currency = [...byCur.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? defaultMarket.currency;
  const symbol = orders.find((o) => o.currency === currency) ? marketplace(orders.find((o) => o.currency === currency)!.marketplace).symbol : defaultMarket.symbol;
  const cur = totals(orders, currency, since, end);
  const prev = totals(orders, currency, prevSince, since);
  const series = dailySeries(orders, currency, 30, now);
  const top = topProducts(orders.filter((o) => o.createdAt >= since), currency, 5);
  const markets = ordersByMarket(orders.filter((o) => o.createdAt >= since));
  const marketsTotal = markets.reduce((s, m) => s + m.orders, 0);
  const otherCur = [...byCur.keys()].filter((c) => c !== currency);

  const money = (v: number, sym = symbol) => new Intl.NumberFormat(tag, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) + " " + sym;
  const margin = cur.revenue > 0 ? Math.round((cur.profit / cur.revenue) * 100) : null;
  const prevMargin = prev.revenue > 0 ? Math.round((prev.profit / prev.revenue) * 100) : null;
  const aov = cur.orders > 0 ? cur.revenue / cur.orders : null;
  const delta = (c: number, p: number) => {
    const d = change(c, p);
    if (d === null) return <span className="text-subtle">{D.noPrev}</span>;
    return <span className={d >= 0 ? "text-emerald-300" : "text-red-300"}>{fmt(D.vsPrev, { p: `${d > 0 ? "+" : ""}${d}` })}</span>;
  };

  const pauseCounts = PAUSE_REASONS.map((r) => ({ r, n: pausedList.filter((l) => l.pauseReason === r).length })).filter((x) => x.n > 0);
  const listingTotal = active + paused + drafts;

  const steps = [
    { done: user.plan !== "NONE", label: D.stepPlan, href: "/billing" },
    { done: user.ebayAccounts.length > 0, label: D.stepEbay, href: "/settings" },
    { done: user.supplierAccounts.length > 0, label: D.stepSupplier, href: "/settings" },
    { done: active + paused > 0, label: D.stepFirstListing, href: "/finder" },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const name = user.email.split("@")[0];

  const quick: [string, string, IconName][] = [
    ["/sniper", t.nav.sniper, "zap"],
    ["/finder", t.nav.finder, "search"],
    ["/best-sellers", t.nav.bestSellers, "fire"],
    ["/listings", t.nav.listings, "tag"],
    ["/orders", t.nav.orders, "cart"],
    ["/settings", t.nav.settings, "settings"],
  ];

  return (
    <div className="space-y-6">
      {/* En-tête compact : bonjour, recherche, actions rapides */}
      <section className="relative overflow-hidden rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <div className="pointer-events-none absolute -top-24 right-0 h-56 w-96 rounded-full bg-brand-500/15 blur-3xl" aria-hidden="true" />
        <div className="relative grid gap-5 lg:grid-cols-5 lg:items-center">
          <div className="lg:col-span-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight text-fg">
                {fmt(D.greeting, { name: "" })}<span className="text-gradient">{name}</span>
              </h1>
              <span className={`badge ${user.autoOrder ? "bg-emerald-500/15 text-emerald-300" : "bg-surface-3 text-muted"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${user.autoOrder ? "animate-pulse bg-emerald-400" : "bg-subtle"}`} aria-hidden="true" />
                {user.autoOrder ? D.autoOn : D.autoOff}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted">{D.subtitle}</p>
          </div>
          <form action="/finder" method="get" className="lg:col-span-3">
            <label htmlFor="q" className="sr-only">{D.heroTitle}</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Icon name="search" className="pointer-events-none absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2 text-subtle" />
                <input id="q" name="q" required minLength={2} placeholder={t.nav.searchPlaceholder} className="input h-11 rounded-xl pl-12" />
              </div>
              <button className="btn-primary h-11 px-5">{t.nav.analyze}<Icon name="arrowRight" className="h-4 w-4" /></button>
            </div>
            <p className="mt-1.5 text-xs text-subtle">{D.heroHint}</p>
          </form>
        </div>
        <nav className="relative mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {quick.map(([href, label, icon]) => (
            <Link key={href} href={href} className="group flex min-w-0 items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-sm text-fg-2 transition hover:border-brand-500/40 hover:text-fg">
              <Icon name={icon} className="h-4 w-4 shrink-0 text-brand-300" />
              <span className="truncate">{label}</span>
            </Link>
          ))}
        </nav>
      </section>

      {needsReview > 0 && (
        <Notice>
          <span className="flex flex-wrap items-center justify-between gap-2">
            {fmt(D.attention, { n: needsReview })}
            <Link href="/orders" className="font-semibold underline underline-offset-2">{D.seeOrders}</Link>
          </span>
        </Notice>
      )}

      {/* Chiffres clés sur 30 jours, comparés aux 30 jours précédents */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label={D.kpiRevenue} value={money(cur.revenue)} icon="dollar" tone="fuchsia" hint={<>{delta(cur.revenue, prev.revenue)}{otherCur.length ? <span className="block text-subtle">{fmt(D.otherCurrencies, { list: otherCur.join(", ") })}</span> : null}</>} />
        <StatCard label={D.kpiProfit} value={<span className={cur.profit < 0 ? "text-red-300" : "text-emerald-300"}>{money(cur.profit)}</span>} icon="trend" tone="emerald" hint={delta(cur.profit, prev.profit)} />
        <StatCard label={D.kpiOrders} value={cur.orders} icon="cart" tone="sky" hint={delta(cur.orders, prev.orders)} />
        <StatCard label={D.kpiMargin} value={margin !== null ? `${margin} %` : "—"} icon="percent" tone="brand" hint={prevMargin !== null && margin !== null ? <span className={margin >= prevMargin ? "text-emerald-300" : "text-red-300"}>{fmt(D.vsPrevPts, { p: `${margin - prevMargin > 0 ? "+" : ""}${margin - prevMargin}` })}</span> : <span className="text-subtle">{D.noPrev}</span>} />
        <StatCard label={D.activeListings} value={active} icon="tag" tone="brand" hint={fmt(D.kpiListingsHint, { paused, drafts })} />
        <StatCard label={D.kpiAov} value={aov !== null ? money(aov) : "—"} icon="card" tone="sky" hint={cur.units ? fmt(D.topUnits, { n: cur.units }) : undefined} />
        <Link href={needsReview ? "/orders" : "/returns"} className="contents">
          <StatCard label={D.kpiToHandle} value={<span className={needsReview + openReturns > 0 ? "text-amber-300" : ""}>{needsReview + openReturns}</span>} icon="alert" tone="amber" hint={fmt(D.kpiToHandleHint, { orders: needsReview, returns: openReturns })} />
        </Link>
        <Link href="/sniper" className="contents">
          <StatCard label={D.kpiSniper} value={lastRun ? lastRun.found : "—"} icon="zap" tone="fuchsia" hint={lastRun ? fmt(D.sniperStats, { found: lastRun.found, scanned: lastRun.scanned }) : D.kpiSniperHint} />
        </Link>
      </section>

      {/* Graphique des ventes + santé des annonces */}
      <section className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        <div className="card min-w-0 lg:col-span-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold text-fg">{D.chartTitle}</h2>
            <p className="text-sm text-muted tabular-nums">{money(cur.revenue)} · <span className="text-emerald-300">{money(cur.profit)}</span></p>
          </div>
          {cur.orders > 0 ? (
            <div className="mt-4">
              <SalesChart points={series} labels={{ revenue: D.chartRevenue, profit: D.chartProfit, orders: t.nav.orders.toLowerCase() }} localeTag={tag} symbol={symbol} />
            </div>
          ) : (
            <div className="mt-4 grid h-48 place-items-center rounded-xl border border-dashed border-line-strong bg-surface-2/40 text-center">
              <div>
                <Icon name="trend" className="mx-auto h-6 w-6 text-subtle" />
                <p className="mt-2 max-w-xs text-sm text-muted">{D.chartEmpty}</p>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          {doneCount < steps.length && (
            <div className="card">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-fg">{D.onboarding}</h2>
                <span className="text-xs text-muted">{fmt(D.progress, { done: doneCount, total: steps.length })}</span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3">
                <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-fuchsia-500" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
              </div>
              <ul className="mt-3 space-y-0.5">
                {steps.map((s) => (
                  <li key={s.label}>
                    {s.done ? (
                      <span className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm text-subtle line-through decoration-subtle/60">
                        <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-500/20 text-emerald-300"><Icon name="check" className="h-3 w-3" strokeWidth={3} /></span>
                        {s.label}
                      </span>
                    ) : (
                      <Link href={s.href} className="group flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm text-fg-2 hover:bg-surface-2 hover:text-fg">
                        <span className="h-5 w-5 rounded-full border-2 border-line-strong group-hover:border-brand-400" />
                        <span className="flex-1">{s.label}</span>
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="card">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-fg">{D.healthTitle}</h2>
              <Link href="/listings" className="text-sm font-medium text-brand-300 hover:text-brand-200">{D.viewAll}</Link>
            </div>
            {/* Barre de répartition des annonces */}
            <div className="mt-4 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
              {listingTotal > 0 && (
                <>
                  <span className="bg-emerald-400" style={{ width: `${(active / listingTotal) * 100}%` }} />
                  <span className="bg-amber-400" style={{ width: `${(paused / listingTotal) * 100}%` }} />
                  <span className="bg-line-strong" style={{ width: `${(drafts / listingTotal) * 100}%` }} />
                </>
              )}
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              {([[D.healthActive, active, "bg-emerald-400"], [D.healthPaused, paused, "bg-amber-400"], [D.healthDraft, drafts, "bg-line-strong"]] as const).map(([label, value, dot]) => (
                <div key={label} className="rounded-xl bg-surface-2 px-2 py-2.5 ring-1 ring-line">
                  <dd className="text-lg font-semibold text-fg tabular-nums">{value}</dd>
                  <dt className="mt-0.5 flex items-center justify-center gap-1 text-[11px] leading-tight text-subtle"><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />{label}</dt>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-xs font-medium text-muted">{D.pausedWhy}</p>
            {pauseCounts.length ? (
              <ul className="mt-2 space-y-1.5 text-sm">
                {pauseCounts.map(({ r, n }) => (
                  <li key={r} className="flex justify-between gap-3 text-fg-2"><span>{D[`pause${r}`]}</span><span className="tabular-nums text-muted">{n}</span></li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-subtle">{D.noPaused}</p>
            )}
          </div>
        </div>
      </section>

      {/* Commandes, meilleurs produits, Sniper, pays */}
      <section className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        <div className="card p-0 min-w-0">
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <h2 className="font-semibold text-fg">{D.recentTitle}</h2>
            <Link href="/orders" className="text-sm font-medium text-brand-300 hover:text-brand-200">{D.viewAll}</Link>
          </div>
          {recent.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted">{D.noOrders}</p>
          ) : (
            <ul className="divide-y divide-line">
              {recent.map((o) => {
                const m = marketplace(o.marketplace);
                const lines = (o.lines as unknown as OrderLine[]) ?? [];
                return (
                  <li key={o.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-fg">{lines[0] ? `${lines[0].quantity} × ${lines[0].title}` : o.ebayOrderId}</p>
                      <p className="text-xs text-subtle">{(o.ebayCreatedAt ?? o.createdAt).toLocaleDateString(tag)} · {t.markets[m.id]}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={`text-sm font-semibold tabular-nums ${o.profit !== null && o.profit < 0 ? "text-red-300" : "text-emerald-300"}`}>
                        {o.profit !== null ? `${o.profit > 0 ? "+" : ""}${money(o.profit, m.symbol)}` : "—"}
                      </p>
                      <StatusBadge tone={ORDER_TONE[o.status]}>{t.orders.status[o.status]}</StatusBadge>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="card min-w-0">
          <h2 className="font-semibold text-fg">{D.topTitle}</h2>
          {top.length === 0 ? (
            <p className="mt-2 text-sm text-muted">{D.topEmpty}</p>
          ) : (
            <ol className="mt-3 space-y-3">
              {top.map((p, i) => (
                <li key={p.title + i} className="min-w-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="min-w-0 truncate text-sm text-fg-2" title={p.title}><span className="mr-1.5 text-subtle tabular-nums">{i + 1}.</span>{p.title}</p>
                    <p className="shrink-0 text-sm font-semibold text-emerald-300 tabular-nums">{money(p.profit)}</p>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
                    <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.max(4, (p.profit / Math.max(1, top[0].profit)) * 100)}%` }} />
                  </div>
                  <p className="mt-0.5 text-[11px] text-subtle">{fmt(D.topUnits, { n: p.units })} · {money(p.revenue)}</p>
                </li>
              ))}
            </ol>
          )}

          <h2 className="mt-6 font-semibold text-fg">{D.marketsTitle}</h2>
          {markets.length === 0 ? (
            <p className="mt-2 text-sm text-muted">{D.marketsEmpty}</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {markets.map((m) => (
                <li key={m.marketplace} className="text-sm">
                  <div className="flex justify-between gap-3 text-fg-2"><span>{t.markets[m.marketplace as MarketplaceId] ?? m.marketplace}</span><span className="tabular-nums text-muted">{m.orders}</span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-sky-400" style={{ width: `${(m.orders / marketsTotal) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card min-w-0">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold text-fg"><Icon name="zap" className="h-4 w-4 text-brand-300" />{D.sniperTitle}</h2>
            <Link href="/sniper" className="text-sm font-medium text-brand-300 hover:text-brand-200">{D.sniperOpen}</Link>
          </div>
          {!lastRun ? (
            <div className="mt-3">
              <p className="text-sm text-muted">{D.sniperEmpty}</p>
              <Link href="/sniper" className="btn-primary mt-4 px-4 py-2 text-sm">{t.sniper.launch}</Link>
            </div>
          ) : (
            <>
              <p className="mt-1 text-xs text-subtle">{fmt(D.sniperStats, { found: lastRun.found, scanned: lastRun.scanned })} · {lastRun.createdAt.toLocaleDateString(tag)}</p>
              {sniperTop.length === 0 ? (
                <p className="mt-3 text-sm text-muted">{D.sniperNone}</p>
              ) : (
                <ul className="mt-3 divide-y divide-line">
                  {sniperTop.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 py-2.5">
                      {c.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.image} alt="" className="h-10 w-10 shrink-0 rounded-lg bg-white object-contain" loading="lazy" />
                      ) : (
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-surface-2 text-subtle"><Icon name="box" className="h-4 w-4" /></span>
                      )}
                      <p className="min-w-0 flex-1 truncate text-sm text-fg-2" title={c.title ?? c.keyword}>{c.title ?? c.keyword}</p>
                      <p className="shrink-0 text-right text-sm tabular-nums">
                        <span className="font-semibold text-emerald-300">{c.profit !== null ? `+${money(c.profit, marketplace(lastRun.marketplace).symbol)}` : "—"}</span>
                        <span className="block text-[11px] text-subtle">{c.marginPct !== null ? `${c.marginPct} %` : ""}</span>
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </section>

    </div>
  );
}
