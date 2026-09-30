"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { fmt, LOCALE_TAGS, type Dict, type Locale } from "@/lib/i18n";
import { errorMessage } from "@/lib/i18n/errors";
import { marketplace, type MarketplaceId } from "@/lib/marketplaces";
import type { SellerAnalysis } from "@/lib/research-service";
import { Icon } from "@/components/icons";
import { Notice, PageHeader, StatCard } from "@/components/ui";

interface Saved { username: string; market: MarketplaceId }

export default function CompetitorsClient({
  t, markets, errors, locale, marketIds, defaultMarket, initialSeller, saved: initialSaved,
}: {
  t: Dict["research"];
  markets: Dict["markets"];
  errors: Dict["errors"];
  locale: Locale;
  marketIds: MarketplaceId[];
  defaultMarket: MarketplaceId;
  initialSeller?: string;
  saved: Saved[];
}) {
  const [seller, setSeller] = useState(initialSeller ?? "");
  const [market, setMarket] = useState<MarketplaceId>(defaultMarket);
  const [keyword, setKeyword] = useState("");
  const [report, setReport] = useState<SellerAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved[]>(initialSaved);
  const started = useRef(false);

  const nf = (v: number, digits = 0) => new Intl.NumberFormat(LOCALE_TAGS[locale], { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
  const sym = marketplace(report?.marketId ?? market).symbol;
  const money = (v: number) => `${nf(v, v < 1000 ? 2 : 0)} ${sym}`;

  async function analyze(u = seller, m = market, k = keyword) {
    if (!u.trim()) return;
    setLoading(true);
    setError(null);
    const q = new URLSearchParams({ username: u, market: m, keyword: k });
    const res = await fetch(`/api/research/seller?${q}`).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setLoading(false);
    if (!res?.ok) return setError(errorMessage(errors, data.error));
    setReport(data as SellerAnalysis);
  }

  useEffect(() => {
    if (initialSeller && !started.current) {
      started.current = true;
      analyze(initialSeller, defaultMarket, "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isSaved = report ? saved.some((s) => s.username === report.username && s.market === report.marketId) : false;
  async function toggleSave() {
    if (!report) return;
    const body = JSON.stringify({ username: report.username, market: report.marketId });
    const res = await fetch("/api/research/saved", { method: isSaved ? "DELETE" : "POST", headers: { "Content-Type": "application/json" }, body });
    if (res.ok) setSaved((l) => (isSaved ? l.filter((s) => !(s.username === report.username && s.market === report.marketId)) : [{ username: report.username, market: report.marketId }, ...l]));
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t.competitorsTitle} subtitle={t.competitorsSubtitle} />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-4">
        <form onSubmit={(e) => { e.preventDefault(); analyze(); }} className="card space-y-4 lg:col-span-3">
          <div className="grid gap-3 md:grid-cols-[2fr_1.3fr_1fr]">
            <label className="block text-sm font-medium text-fg-2">
              {t.sellerLabel}
              <div className="relative mt-1.5">
                <Icon name="eye" className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-subtle" />
                <input value={seller} onChange={(e) => setSeller(e.target.value)} required placeholder={t.sellerPlaceholder} className="input py-2 pl-10" />
              </div>
            </label>
            <label className="block text-sm font-medium text-fg-2">
              {t.keywordLabel}
              <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder={t.keywordPlaceholder} className="input mt-1.5 py-2" />
            </label>
            <label className="block text-sm font-medium text-fg-2">
              {t.market}
              <select value={market} onChange={(e) => setMarket(e.target.value as MarketplaceId)} className="input mt-1.5 py-2">
                {marketIds.map((id) => <option key={id} value={id}>{markets[id]}</option>)}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-subtle">{t.keywordHint}</p>
            <button disabled={loading} className="btn-primary px-5 py-2.5">
              {loading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <Icon name="search" className="h-4 w-4" />}
              {loading ? t.analyzing : t.analyze}
            </button>
          </div>
        </form>

        <aside className="card p-5">
          <h2 className="text-sm font-semibold text-fg">{t.savedTitle}</h2>
          {saved.length === 0 ? (
            <p className="mt-2 text-xs text-subtle">{t.noSaved}</p>
          ) : (
            <ul className="mt-3 space-y-1">
              {saved.map((s) => (
                <li key={`${s.username}-${s.market}`}>
                  <button
                    onClick={() => { setSeller(s.username); setMarket(s.market); setKeyword(""); analyze(s.username, s.market, ""); }}
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-fg-2 hover:bg-surface-2 hover:text-fg"
                  >
                    <span className="truncate">{s.username}</span>
                    <span className="text-xs text-subtle">{marketplace(s.market).country}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      {error && <Notice tone="red">{error}</Notice>}

      {report && !loading && (
        <section className="space-y-6">
          <div className="card flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-brand-400 to-fuchsia-500 text-lg font-bold text-white">{report.username[0]?.toUpperCase()}</span>
              <div>
                <p className="text-lg font-semibold text-fg">{report.username}</p>
                <p className="text-xs text-subtle">
                  {markets[report.marketId]}
                  {report.feedbackScore !== null && ` · ${fmt(t.feedback, { score: nf(report.feedbackScore), pct: report.feedbackPercentage ?? "—" })}`}
                  {report.keyword && ` · « ${report.keyword} »`}
                </p>
              </div>
            </div>
            <button onClick={toggleSave} className={isSaved ? "btn-secondary px-4 py-2 text-sm" : "btn-primary px-4 py-2 text-sm"}>
              <Icon name={isSaved ? "check" : "plus"} className="h-4 w-4" />
              {isSaved ? t.following : t.follow}
            </button>
          </div>

          {report.listings === 0 ? (
            <Notice>{t.noItems}</Notice>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                <StatCard label={t.kpiListings} value={nf(report.totalListings)} icon="tag" tone="sky" />
                <StatCard label={t.kpiSold} value={nf(report.unitsSold)} icon="cart" tone="brand" hint={`${t.kpiSellThrough} : ${report.sellThrough} %`} />
                <StatCard label={t.kpiRevenue} value={<span className="text-emerald-300">{money(report.revenue)}</span>} icon="dollar" tone="emerald" />
                <StatCard label={t.kpiAvgPrice} value={money(report.avgPrice)} icon="percent" tone="fuchsia" />
              </div>
              <p className="text-xs text-subtle">{fmt(t.soldNote, { n: report.listings })}</p>

              <div className="card overflow-hidden p-0">
                <h2 className="px-6 pt-5 pb-3 font-semibold text-fg">{t.topTitle}</h2>
                <ul className="divide-y divide-line">
                  {report.top.slice(0, 30).map((it, i) => (
                    <li key={it.id} className="flex flex-wrap items-center gap-4 px-5 py-3 sm:px-6">
                      <span className="w-6 text-right text-xs font-semibold text-subtle tabular-nums">{i + 1}</span>
                      {it.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={it.image} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-lg bg-white object-contain" />
                      ) : (
                        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-surface-2 text-subtle"><Icon name="box" className="h-4 w-4" /></span>
                      )}
                      <div className="min-w-0 flex-1 basis-48">
                        <p className="line-clamp-2 text-sm font-medium text-fg">{it.title}</p>
                        <p className="mt-0.5 text-xs text-subtle">{money(it.price)} · {fmt(t.sales, { n: nf(it.sold) })} · <span className="text-emerald-300">{money(it.sold * it.price)}</span></p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Link href={`/finder?q=${encodeURIComponent(it.title.split(/\s+/).slice(0, 6).join(" "))}`} className="btn-secondary px-3 py-1.5 text-xs">{t.check}</Link>
                        <Link href={`/title-builder?q=${encodeURIComponent(it.title.split(/\s+/).slice(0, 4).join(" "))}&m=${report.marketId}`} className="btn-ghost px-2 py-1.5 text-xs" title={t.titleIt}><Icon name="type" className="h-4 w-4" /></Link>
                        {it.url && <a href={it.url} target="_blank" rel="noopener noreferrer" className="btn-ghost px-2 py-1.5 text-xs" title={t.view}><Icon name="external" className="h-4 w-4" /></a>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
