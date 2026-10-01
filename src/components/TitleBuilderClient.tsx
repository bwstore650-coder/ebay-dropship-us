"use client";
import { useEffect, useRef, useState } from "react";
import { fmt, LOCALE_TAGS, type Dict, type Locale } from "@/lib/i18n";
import { errorMessage } from "@/lib/i18n/errors";
import { marketplace, type MarketplaceId } from "@/lib/marketplaces";
import { TITLE_MAX } from "@/lib/research";
import type { TitleAnalysis } from "@/lib/research-service";
import { Icon } from "@/components/icons";
import { Notice, PageHeader } from "@/components/ui";

export default function TitleBuilderClient({
  t, markets, errors, locale, marketIds, defaultMarket, initialKeyword,
}: {
  t: Dict["research"];
  markets: Dict["markets"];
  errors: Dict["errors"];
  locale: Locale;
  marketIds: MarketplaceId[];
  defaultMarket: MarketplaceId;
  initialKeyword?: string;
}) {
  const [keyword, setKeyword] = useState(initialKeyword ?? "");
  const [market, setMarket] = useState<MarketplaceId>(defaultMarket);
  const [data, setData] = useState<TitleAnalysis | null>(null);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const started = useRef(false);
  const nf = (v: number) => new Intl.NumberFormat(LOCALE_TAGS[locale]).format(v);

  async function run(k = keyword, m = market) {
    if (k.trim().length < 2) return;
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/research/titles?${new URLSearchParams({ keyword: k, market: m })}`).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    setLoading(false);
    if (!res?.ok) return setError(errorMessage(errors, d.error));
    setData(d as TitleAnalysis);
  }

  useEffect(() => {
    if (initialKeyword && !started.current) {
      started.current = true;
      run(initialKeyword, defaultMarket);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const used = new Set(title.toLowerCase().split(/\s+/).filter(Boolean));
  const add = (w: string) => {
    if (used.has(w)) return setTitle((s) => s.split(/\s+/).filter((x) => x.toLowerCase() !== w).join(" "));
    const next = `${title.trim()} ${w[0].toUpperCase()}${w.slice(1)}`.trim();
    if (next.length <= TITLE_MAX) setTitle(next);
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t.titlesTitle} subtitle={t.titlesSubtitle} />

      <form onSubmit={(e) => { e.preventDefault(); run(); }} className="card flex flex-col gap-2 lg:flex-row">
        <div className="relative flex-1">
          <Icon name="type" className="pointer-events-none absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2 text-subtle" />
          <input value={keyword} onChange={(e) => setKeyword(e.target.value)} required minLength={2} placeholder={t.titleKeywordPlaceholder} aria-label={t.titleKeyword} className="input h-12 pl-12 text-[15px]" />
        </div>
        <select value={market} onChange={(e) => setMarket(e.target.value as MarketplaceId)} aria-label={t.market} className="input h-12 lg:w-56">
          {marketIds.map((id) => <option key={id} value={id}>{markets[id]}</option>)}
        </select>
        <button disabled={loading} className="btn-primary h-12 px-6">
          {loading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <Icon name="search" className="h-4 w-4" />}
          {loading ? t.analyzing : t.analyze}
        </button>
      </form>

      {error && <Notice tone="red">{error}</Notice>}

      {data && !loading && (
        <>
          {/* Titre en construction */}
          <section className="card sticky top-16 z-20 space-y-3 border-brand-500/30 lg:top-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold text-fg">{t.yourTitle}</h2>
              <span className={`text-xs tabular-nums ${title.length > TITLE_MAX - 5 ? "text-amber-300" : "text-subtle"}`}>{fmt(t.chars, { n: title.length })}</span>
            </div>
            <input value={title} onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))} className="input py-2.5 text-[15px] font-medium" aria-label={t.yourTitle} />
            <div className="h-1 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-fuchsia-500 transition-all" style={{ width: `${(title.length / TITLE_MAX) * 100}%` }} />
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setTitle(data.suggestion)} className="btn-secondary px-3 py-1.5 text-sm"><Icon name="zap" className="h-4 w-4" />{t.useSuggestion}</button>
              <button
                type="button"
                disabled={!title}
                onClick={async () => { await navigator.clipboard.writeText(title).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                className="btn-primary px-3 py-1.5 text-sm"
              >
                <Icon name={copied ? "check" : "copy"} className="h-4 w-4" />{copied ? t.copied : t.copy}
              </button>
              {title && <button type="button" onClick={() => setTitle("")} className="btn-ghost text-sm">{t.clear}</button>}
            </div>
          </section>

          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-5">
            <section className="card lg:col-span-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold text-fg">{t.wordsTitle}</h2>
                <span className="text-xs text-subtle">{fmt(t.analyzedNote, { listings: data.listingsAnalyzed })}</span>
              </div>
              <p className="mt-1 text-xs text-subtle">{t.wordsHint}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {data.keywords.map((k) => {
                  const on = used.has(k.word);
                  return (
                    <button
                      key={k.word}
                      type="button"
                      disabled={k.vero}
                      onClick={() => add(k.word)}
                      title={k.vero ? t.vero : `${fmt(t.sales, { n: nf(k.sold) })} · ${fmt(t.inListings, { n: k.listings })}`}
                      className={`group inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm transition ${
                        k.vero
                          ? "cursor-not-allowed border-red-500/30 bg-red-500/10 text-red-300 line-through"
                          : on
                            ? "border-brand-500/60 bg-brand-500/15 text-fg"
                            : "border-line bg-surface-2 text-fg-2 hover:border-line-strong hover:text-fg"
                      }`}
                    >
                      {k.word}
                      <span className="rounded bg-black/20 px-1.5 text-[11px] font-semibold tabular-nums text-muted">{k.score}%</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="card p-0 lg:col-span-2">
              <h2 className="px-5 pt-5 pb-3 font-semibold text-fg">{t.topTitlesTitle}</h2>
              <ol className="divide-y divide-line">
                {data.topTitles.map((it, i) => (
                  <li key={i} className="flex gap-3 px-5 py-3 text-sm">
                    <span className="w-5 text-right text-xs font-semibold text-subtle">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-fg-2">{it.title}</p>
                      <p className="mt-0.5 text-xs text-subtle">{fmt(t.sales, { n: nf(it.sold) })} · {it.price.toFixed(2)} {marketplace(data.marketId).symbol}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
