"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fmt, type Dict } from "@/lib/i18n";
import { errorMessage } from "@/lib/i18n/errors";
import { cjProductUrl, ebaySearchUrl } from "@/lib/listing";
import { isMarketplaceId, marketplace, type MarketplaceId } from "@/lib/marketplaces";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/ui";

export interface SavedItem {
  id: string;
  supplier: "CJ" | "ALIEXPRESS";
  productId: string;
  title: string | null;
  image: string | null;
  keyword: string | null;
  marketId: string | null;
  price: number | null;
  cost: number | null;
  profit: number | null;
  marginPct: number | null;
  createdAt: string;
}

type Sort = "recent" | "profit" | "margin";

export default function SavedClient({ t, errors, locale, max, defaultMarket, initial }: {
  t: Dict["saved"];
  errors: Dict["errors"];
  locale: string;
  max: number;
  defaultMarket: MarketplaceId;
  initial: SavedItem[];
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle ? items.filter((i) => `${i.title ?? ""} ${i.keyword ?? ""} ${i.productId}`.toLowerCase().includes(needle)) : items;
    const val = (v: number | null) => (v === null ? -Infinity : v);
    return [...list].sort((a, b) =>
      sort === "profit" ? val(b.profit) - val(a.profit) : sort === "margin" ? val(b.marginPct) - val(a.marginPct) : b.createdAt.localeCompare(a.createdAt));
  }, [items, q, sort]);

  const date = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  const money = (v: number | null, m: string | null) => (v === null ? "—" : `${v.toFixed(2)} ${marketplace(m && isMarketplaceId(m) ? (m as MarketplaceId) : defaultMarket).symbol}`);

  async function remove(i: SavedItem) {
    setError(null);
    const before = items;
    setItems((l) => l.filter((x) => x.id !== i.id));
    const res = await fetch(`/api/saved?${new URLSearchParams({ supplier: i.supplier, productId: i.productId })}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) { setItems(before); setError(errorMessage(errors, "GENERIC")); }
  }

  async function removeAll() {
    setError(null);
    setConfirmAll(false);
    const before = items;
    setItems([]);
    const res = await fetch("/api/saved?all=1", { method: "DELETE" }).catch(() => null);
    if (!res?.ok) { setItems(before); setError(errorMessage(errors, "GENERIC")); }
  }

  async function reanalyze() {
    setError(null);
    setSending(true);
    const res = await fetch("/api/saved/sniper", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ marketId: defaultMarket }) }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) { setSending(false); return setError(errorMessage(errors, data.error)); }
    router.push("/sniper");
  }

  const hasCj = items.some((i) => i.supplier === "CJ");

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        actions={items.length > 0 && hasCj ? (
          <button onClick={reanalyze} disabled={sending} className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm">
            <Icon name="zap" className="h-4 w-4" />{sending ? t.sending : t.reanalyze}
          </button>
        ) : undefined}
      />

      {error && <p className="text-sm text-red-300" role="alert">{error}</p>}

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface/50 p-10 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-surface-2 text-subtle"><Icon name="bookmark" /></span>
          <p className="mt-4 text-sm font-medium text-fg">{t.emptyTitle}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">{t.emptyText}</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Link href="/sniper" className="btn-primary px-4 py-2 text-sm">{t.goSniper}</Link>
            <Link href="/best-sellers" className="btn-secondary px-4 py-2 text-sm">{t.goWinners}</Link>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.search} aria-label={t.search} className="input w-full py-2 sm:w-64" />
            <label className="flex items-center gap-2 text-sm text-muted">
              {t.sortLabel}
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="input w-auto py-2">
                <option value="recent">{t.sortRecent}</option>
                <option value="profit">{t.sortProfit}</option>
                <option value="margin">{t.sortMargin}</option>
              </select>
            </label>
            <span className="text-sm text-subtle">{fmt(t.count, { n: items.length, max })}</span>
            <span className="flex-1" />
            {confirmAll ? (
              <span className="flex items-center gap-2 text-sm">
                <span className="text-muted">{t.confirmAll}</span>
                <button onClick={removeAll} className="rounded-lg bg-red-500/15 px-3 py-1.5 font-medium text-red-300 hover:bg-red-500/25">{t.confirmYes}</button>
                <button onClick={() => setConfirmAll(false)} className="btn-ghost px-3 py-1.5">{t.confirmNo}</button>
              </span>
            ) : (
              <button onClick={() => setConfirmAll(true)} className="btn-ghost px-3 py-1.5 text-sm text-muted">{t.removeAll}</button>
            )}
          </div>

          {shown.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line-strong bg-surface/50 p-8 text-center text-sm text-muted">{t.noMatch}</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {shown.map((i) => {
                const m = i.marketId && isMarketplaceId(i.marketId) ? (i.marketId as MarketplaceId) : defaultMarket;
                const hasNumbers = i.profit !== null || i.price !== null || i.cost !== null;
                const tone = i.profit === null ? "text-muted" : i.profit > 0 ? "text-emerald-300" : "text-red-300";
                return (
                  <article key={i.id} className="card flex min-w-0 flex-col p-0">
                    <div className="flex gap-4 p-5">
                      {i.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={i.image} alt="" className="h-20 w-20 shrink-0 rounded-xl bg-white object-contain" loading="lazy" />
                      ) : (
                        <span className="grid h-20 w-20 shrink-0 place-items-center rounded-xl bg-surface-2 text-subtle"><Icon name="box" /></span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-sm font-medium text-fg" title={i.title ?? i.productId}>{i.title ?? i.keyword ?? i.productId}</p>
                        <p className="mt-1 text-xs text-subtle">{fmt(t.savedOn, { date: date(i.createdAt) })} · {i.supplier === "CJ" ? "CJ" : "AliExpress"}</p>
                        {hasNumbers ? (
                          <p className="mt-2 flex flex-wrap items-baseline gap-x-2 tabular-nums">
                            <span className={`text-lg font-semibold ${tone}`}>{i.profit !== null ? `${i.profit > 0 ? "+" : ""}${money(i.profit, m)}` : "—"}</span>
                            {i.marginPct !== null && <span className={`text-sm font-medium ${tone}`}>{fmt(t.margin, { pct: i.marginPct })}</span>}
                          </p>
                        ) : (
                          <p className="mt-2 text-xs text-muted">{t.noNumbers}</p>
                        )}
                      </div>
                    </div>

                    {hasNumbers && (
                      <dl className="mx-5 mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line text-xs">
                        <div className="bg-surface px-3 py-2"><dt className="text-subtle">{t.ebayPrice}</dt><dd className="mt-0.5 font-medium text-fg-2 tabular-nums">{money(i.price, m)}</dd></div>
                        <div className="bg-surface px-3 py-2"><dt className="text-subtle">{t.cost}</dt><dd className="mt-0.5 font-medium text-fg-2 tabular-nums">{money(i.cost, m)}</dd></div>
                      </dl>
                    )}
                    {hasNumbers && <p className="mx-5 mb-4 text-[11px] text-subtle">{fmt(t.snapshotNote, { date: date(i.createdAt) })}</p>}

                    <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line p-4 text-xs">
                      {i.supplier === "CJ" && (
                        <Link href={`/products/cj/${encodeURIComponent(i.productId)}?m=${m}`} className="btn-primary px-3 py-1.5 text-xs">{t.open}</Link>
                      )}
                      {i.supplier === "CJ" && (
                        <a href={cjProductUrl(i.productId, i.title)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 font-medium text-fg-2 hover:border-brand-500/50 hover:text-fg">
                          {t.viewCj} <span aria-hidden="true">↗</span>
                        </a>
                      )}
                      {i.keyword && (
                        <a href={ebaySearchUrl(m, i.keyword)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 font-medium text-fg-2 hover:border-brand-500/50 hover:text-fg">
                          {t.viewEbay} <span aria-hidden="true">↗</span>
                        </a>
                      )}
                      <span className="flex-1" />
                      <button onClick={() => remove(i)} className="rounded-lg px-2.5 py-1.5 font-medium text-muted hover:bg-red-500/10 hover:text-red-300">{t.remove}</button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
