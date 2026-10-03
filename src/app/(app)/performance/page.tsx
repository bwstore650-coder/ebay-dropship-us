import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canReadStandards } from "@/lib/ebay";
import { fmt, LOCALE_TAGS } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { marketplace } from "@/lib/marketplaces";
import { TRAFFIC_PERIODS, trafficOverview, type TrafficOverview, type TrafficTotals } from "@/lib/traffic";
import TrafficChart from "@/components/TrafficChart";
import { ebayItemUrl } from "@/lib/listing";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function PerformancePage({ searchParams }: { searchParams: Promise<{ days?: string; fresh?: string }> }) {
  const { days: daysParam, fresh } = await searchParams;
  const user = await requireUser();
  const { locale, t } = await getI18n();
  const P = t.performance;
  const tag = LOCALE_TAGS[locale];
  const days: number = TRAFFIC_PERIODS.find((d) => String(d) === daysParam) ?? 30;
  const m = marketplace(user.defaultMarketplace);
  const account = user.ebayAccounts[0] ?? null;
  const needsReconnect = account ? !canReadStandards((account as { scopes?: string | null }).scopes) : false;

  let data: TrafficOverview | null = null;
  if (account && !needsReconnect) {
    data = await trafficOverview(user.id, account, m.id, days, fresh === "1").catch((e) => {
      console.error("Performance", e);
      return null;
    });
  }

  const num = (v: number) => new Intl.NumberFormat(tag).format(v);
  const pctFmt = (v: number | null) => (v === null ? "—" : `${new Intl.NumberFormat(tag, { maximumFractionDigits: 1 }).format(v)} %`);
  const change = (cur: number | null, prev: number | null) => {
    if (cur === null || prev === null || prev === 0) return <span className="text-subtle">{P.noPrev}</span>;
    const d = Math.round(((cur - prev) / prev) * 1000) / 10;
    return <span className={d >= 0 ? "text-emerald-300" : "text-red-300"}>{d > 0 ? "+" : ""}{d} % <span className="text-subtle">{fmt(P.vsPrev, { d: days })}</span></span>;
  };
  const card = (label: string, value: string, cur: number | null, prev: number | null) => (
    <div className="card">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-fg">{value}</p>
      <p className="mt-1 text-xs tabular-nums">{change(cur, prev)}</p>
    </div>
  );
  const bars = (title: string, rows: [string, number][]) => {
    const total = rows.reduce((s, [, v]) => s + v, 0);
    return (
      <div className="card">
        <h2 className="font-semibold text-fg">{title}</h2>
        <ul className="mt-3 space-y-3 text-sm">
          {rows.map(([label, v]) => (
            <li key={label}>
              <div className="flex justify-between gap-3"><span className="text-muted">{label}</span><span className="tabular-nums text-fg-2">{num(v)}</span></div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-brand-500" style={{ width: `${total ? (v / total) * 100 : 0}%` }} /></div>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">{P.title} · {t.markets[m.id]}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">{P.subtitle}</p>
        </div>
        <nav className="flex items-center gap-1.5" aria-label={t.dashboard.period}>
          {TRAFFIC_PERIODS.map((d) => (
            <Link key={d} href={d === 30 ? "/performance" : `/performance?days=${d}`} aria-current={d === days ? "page" : undefined}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold tabular-nums ${d === days ? "bg-brand-500/20 text-fg ring-1 ring-brand-500/50" : "bg-surface-2 text-muted hover:text-fg"}`}>
              {fmt(t.dashboard.days, { d })}
            </Link>
          ))}
        </nav>
      </div>

      {!account ? (
        <div className="card text-sm text-muted"><p>{P.noAccount}</p><Link href="/settings" className="btn-primary mt-3 inline-flex px-4 py-2 text-sm">{t.health.connect}</Link></div>
      ) : needsReconnect ? (
        <div className="card text-sm text-muted">
          <p>{P.reconnect}</p>
          <a href={`/api/ebay/connect?account=${account.id}`} className="btn-primary mt-3 inline-flex px-4 py-2 text-sm">{P.reconnectBtn}</a>
        </div>
      ) : !data ? (
        <p className="card text-sm text-muted">{P.error}</p>
      ) : (() => {
        const c: TrafficTotals = data.current;
        const p: TrafficTotals = data.previous;
        return (
          <>
            <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
              {card(P.impressions, num(c.impressions), c.impressions, p.impressions)}
              {card(P.views, num(c.views), c.views, p.views)}
              {card(P.sold, num(c.sold), c.sold, p.sold)}
              {card(P.ctr, pctFmt(c.ctr), c.ctr, p.ctr)}
              {card(P.conversion, pctFmt(c.conversion), c.conversion, p.conversion)}
            </section>

            <section className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
              <div className="card min-w-0 lg:col-span-2">
                <h2 className="mb-3 font-semibold text-fg">{P.results}</h2>
                <TrafficChart series={data.series} labels={{ impressions: P.impressions, views: P.views, sold: P.sold }} localeTag={tag} />
              </div>
              <div className="space-y-6">
                {bars(P.sourcesTitle, [[P.srcSearch, c.impressionsBySource.search], [P.srcStore, c.impressionsBySource.store], [P.srcOther, c.impressionsBySource.other]])}
                {bars(P.viewsTitle, [[P.vSearch, c.viewsBySource.search], [P.vStore, c.viewsBySource.store], [P.vDirect, c.viewsBySource.direct], [P.vOff, c.viewsBySource.offEbay], [P.vOther, c.viewsBySource.otherEbay]])}
              </div>
            </section>

            <section className="card overflow-hidden p-0">
              <h2 className="px-5 pt-5 font-semibold text-fg">{P.listingsTitle}</h2>
              {data.listings.length ? (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="border-y border-line text-xs text-subtle">
                      <tr>
                        <th className="px-5 py-2 font-medium">{P.colListing}</th>
                        <th className="px-3 py-2 text-right font-medium">{P.impressions}</th>
                        <th className="px-3 py-2 text-right font-medium">{P.views}</th>
                        <th className="px-3 py-2 text-right font-medium">{P.ctr}</th>
                        <th className="px-5 py-2 text-right font-medium">{P.sold}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {data.listings.map((l) => (
                        <tr key={l.itemId}>
                          <td className="max-w-[360px] px-5 py-2.5">
                            <a href={ebayItemUrl(m.id, l.itemId)} target="_blank" rel="noopener noreferrer" className="block truncate text-fg-2 hover:text-fg">{l.title ?? l.itemId}</a>
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{num(l.impressions)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{num(l.views)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{pctFmt(l.ctr)}</td>
                          <td className="px-5 py-2.5 text-right tabular-nums">{num(l.sold)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="px-5 pt-2 pb-5 text-sm text-muted">{P.noListings}</p>
              )}
            </section>

            <p className="text-xs text-subtle">
              {fmt(P.checked, { time: new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short" }).format(new Date(data.checkedAt)) })} · <Link href={`/performance?days=${days}&fresh=1`} className="text-brand-300 hover:text-brand-200">{P.refresh}</Link>
              <br />{P.note}
            </p>
          </>
        );
      })()}
    </div>
  );
}
