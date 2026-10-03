"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { fmt, type Dict } from "@/lib/i18n";
import { errorMessage } from "@/lib/i18n/errors";
import { marketplace, type MarketplaceId } from "@/lib/marketplaces";
import type { RunState } from "@/lib/sniper-service";
import { CATEGORY_IDS, type CategoryId } from "@/lib/sniper";
import ListingEditor from "@/components/ListingEditor";
import SniperProductCard from "@/components/SniperProductCard";
import { useSavedProducts } from "@/components/useSavedProducts";
import { Icon } from "@/components/icons";
import { SHOW_SALES_DATA } from "@/lib/flags";
import { Notice, PageHeader } from "@/components/ui";

type Mode = "CATALOG" | "KEYWORDS";
type Candidate = RunState["candidates"][number];

export default function SniperClient({
  t, tl, markets, errors, marketIds, defaultMarket, minMargin, cjConnected, accounts, hasGpsr, initial, startHighTicket = false,
}: {
  t: Dict["sniper"];
  tl: Dict["listing"];
  markets: Dict["markets"];
  errors: Dict["errors"];
  marketIds: MarketplaceId[];
  defaultMarket: MarketplaceId;
  minMargin: number;
  cjConnected: boolean;
  accounts: { id: string; label: string }[];
  hasGpsr: boolean;
  initial: RunState | null;
  startHighTicket?: boolean;
}) {
  const [mode, setMode] = useState<Mode>("CATALOG");
  const [run, setRun] = useState<RunState | null>(initial);
  const [showForm, setShowForm] = useState(startHighTicket || !initial || initial.status !== "RUNNING");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoList, setAutoList] = useState(false);
  const [highTicket, setHighTicket] = useState(startHighTicket);
  const [categories, setCategories] = useState<CategoryId[]>([]);
  const toggleCategory = (id: CategoryId) => setCategories((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const [tab, setTab] = useState<"good" | "bad">("good");
  const [sort, setSort] = useState<"profit" | "margin" | "price">("profit");
  const [editing, setEditing] = useState<Candidate | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { isSaved, toggle: toggleSaved } = useSavedProducts(run?.marketId ?? defaultMarket, (code) => setSaveError(errorMessage(errors, code)));
  const alive = useRef(true);

  const running = run?.status === "RUNNING";

  // Tant que la recherche tourne et que la page est ouverte, on la fait avancer étape par étape.
  const loop = useCallback(async (id: string) => {
    while (alive.current) {
      const res = await fetch(`/api/sniper/${id}/step`, { method: "POST" }).catch(() => null);
      const data = res?.ok ? ((await res.json()) as RunState) : null;
      if (!alive.current) return;
      if (data) setRun(data);
      if (!data || data.status !== "RUNNING") return;
      // En pause (quota eBay) : on revérifie chaque minute au lieu de toutes les 1,5 s.
      await new Promise((r) => setTimeout(r, data.pausedUntil ? 60_000 : 1500));
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    if (initial?.status === "RUNNING") loop(initial.id);
    return () => {
      alive.current = false;
    };
  }, [initial, loop]);

  async function start(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStarting(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const num = (k: string) => (f.get(k) ? Number(f.get(k)) : null);
    const res = await fetch("/api/sniper", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
        marketId: f.get("marketId"),
        target: Number(f.get("target")),
        minMarginPct: Number(f.get("minMarginPct")),
        priceMin: num("priceMin"),
        priceMax: num("priceMax"),
        costMin: num("costMin"),
        costMax: num("costMax"),
        minMonthlySales: SHOW_SALES_DATA ? num("minMonthlySales") : null,
        categories: mode === "CATALOG" ? categories : [],
        seeds: String(f.get("seeds") ?? ""),
        autoList,
        ebayAccountId: f.get("ebayAccountId") || null,
        highTicket,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setStarting(false);
    if (!res.ok) return setError(errorMessage(errors, data.error));
    setShowForm(false);
    setTab("good");
    setRun({
      id: data.id, mode, marketId: String(f.get("marketId")) as MarketplaceId, status: "RUNNING", target: Number(f.get("target")),
      minMarginPct: Math.max(minMargin, Number(f.get("minMarginPct")) || 0),
      minProfit: highTicket ? 100 : null,
      priceMin: num("priceMin"), priceMax: num("priceMax"), costMin: num("costMin"), costMax: num("costMax"),
      minMonthlySales: SHOW_SALES_DATA && num("minMonthlySales") ? Math.round(num("minMonthlySales")!) : null,
      categories: mode === "CATALOG" ? categories : [],
      scanned: 0, found: 0, listed: 0, maxScan: 0, exhausted: false, autoList, error: null, pausedUntil: null, createdAt: new Date().toISOString(), candidates: [],
    });
    alive.current = true;
    loop(data.id);
  }

  const [continuing, setContinuing] = useState(false);
  async function keepSearching() {
    if (!run) return;
    setContinuing(true);
    setError(null);
    const res = await fetch(`/api/sniper/${run.id}/continue`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setContinuing(false);
    if (!res.ok) return setError(errorMessage(errors, data.error));
    setRun(data as RunState);
    alive.current = true;
    loop(run.id);
  }

  async function stop() {
    if (!run) return;
    const res = await fetch(`/api/sniper/${run.id}/stop`, { method: "POST" });
    if (res.ok) setRun(await res.json());
  }

  const good = run?.candidates.filter((c) => c.status === "PROFITABLE" || c.status === "LISTED") ?? [];
  const bad = run?.candidates.filter((c) => c.status === "REJECTED" || c.status === "ERROR") ?? [];
  const sym = run ? marketplace(run.marketId).symbol : "";
  const money = (v: number | null) => (v === null ? "—" : `${v.toFixed(2)} ${sym}`);
  const sortValue = (c: Candidate) =>
    sort === "margin" ? c.marginPct ?? -1e9
    : sort === "price" ? c.marketPrice ?? -1
    : c.profit ?? -1e9;
  const sorted = (list: Candidate[]) => [...list].sort((a, b) => sortValue(b) - sortValue(a));
  const reasonText = (c: Candidate) => {
    const r = c.reason ?? (c.status === "ERROR" ? "UPSTREAM" : "");
    if (r.startsWith("AUTO_LIST:")) return fmt(t.reasons.AUTO_LIST, { reason: fmt(errorMessage(errors, r.slice(10)), { detail: "" }) });
    return (t.reasons as Record<string, string>)[r] ?? r;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={<span className="inline-flex items-center gap-3">{t.title}<span className="badge bg-gradient-to-r from-brand-500/25 to-fuchsia-500/25 text-brand-200">Beta</span></span>}
        subtitle={t.subtitle}
        actions={!showForm && !running ? <button onClick={() => setShowForm(true)} className="btn-primary px-4 py-2 text-sm"><Icon name="zap" className="h-4 w-4" />{t.newSearch}</button> : null}
      />

      {!cjConnected && (
        <Notice tone="brand">
          {t.cjRequired} <Link href="/settings" className="font-semibold underline underline-offset-2">{t.cjRequiredLink}</Link>
        </Notice>
      )}

      {showForm && (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
          <form onSubmit={start} className="card space-y-5 lg:col-span-2">
            {/* Mode */}
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
              {([["CATALOG", t.modeCatalog, t.modeCatalogHint, "search"], ["KEYWORDS", t.modeKeywords, t.modeKeywordsHint, "file"]] as const).map(([id, label, hint, icon]) => (
                <button
                  type="button"
                  key={id}
                  role="radio"
                  aria-checked={mode === id}
                  onClick={() => setMode(id)}
                  className={`flex items-start gap-3 rounded-xl border p-4 text-left transition ${mode === id ? "border-brand-500/60 bg-brand-500/10" : "border-line bg-surface-2 hover:border-line-strong"}`}
                >
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${mode === id ? "bg-brand-500/20 text-brand-200" : "bg-surface-3 text-subtle"}`}><Icon name={icon} className="h-4 w-4" /></span>
                  <span>
                    <span className="block text-sm font-semibold text-fg">{label}</span>
                    <span className="mt-0.5 block text-xs text-muted">{hint}</span>
                  </span>
                </button>
              ))}
            </div>

            {/* High ticket : produits chers, au moins 100 de profit par vente */}
            <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${highTicket ? "border-amber-400/60 bg-amber-500/10" : "border-line bg-surface-2 hover:border-line-strong"}`}>
              <button
                type="button"
                role="switch"
                aria-checked={highTicket}
                onClick={() => setHighTicket((v) => !v)}
                className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${highTicket ? "bg-amber-500" : "bg-surface-3 ring-1 ring-line-strong"}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${highTicket ? "left-[22px]" : "left-0.5"}`} />
              </button>
              <span>
                <span className="block text-sm font-semibold text-fg">{t.highTicket}</span>
                <span className="mt-0.5 block text-xs text-muted">{t.highTicketHint}</span>
              </span>
            </label>

            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block text-sm font-medium text-fg-2">
                {t.target}
                <input name="target" type="number" min={1} max={50} defaultValue={10} required className="input mt-1.5 py-2" />
              </label>
              <label className="block text-sm font-medium text-fg-2">
                {t.margin}
                <input name="minMarginPct" type="number" min={minMargin} max={90} defaultValue={minMargin} required className="input mt-1.5 py-2" />
              </label>
              <label className="block text-sm font-medium text-fg-2">
                {t.market}
                <select name="marketId" defaultValue={defaultMarket} className="input mt-1.5 py-2">
                  {marketIds.map((id) => <option key={id} value={id}>{markets[id]}</option>)}
                </select>
              </label>
            </div>
            <p className="-mt-2 text-xs text-subtle">{fmt(t.marginHint, { min: minMargin })} · <Link href="/settings#margin" className="text-brand-300 hover:text-brand-200">{t.marginChange}</Link></p>

            {/* Prix d'achat chez le fournisseur */}
            <fieldset>
              <legend className="text-sm font-medium text-fg-2">{t.costRange}</legend>
              <div className="mt-1.5 flex items-center gap-2">
                <input name="costMin" type="number" min={0} step="0.01" placeholder={t.priceMin} aria-label={`${t.costRange} ${t.priceMin}`} className="input py-2" />
                <span className="text-subtle">–</span>
                <input name="costMax" type="number" min={0} step="0.01" placeholder={t.priceMax} aria-label={`${t.costRange} ${t.priceMax}`} className="input py-2" />
              </div>
              <span className="mt-1.5 block text-xs text-subtle">{t.costRangeHint}</span>
            </fieldset>

            {SHOW_SALES_DATA && (
              <label className="block text-sm font-medium text-fg-2">
                {t.minSales}
                <input name="minMonthlySales" type="number" min={0} max={100000} step={1} placeholder="0" className="input mt-1.5 max-w-[10rem] py-2" />
                <span className="mt-1.5 block text-xs font-normal text-subtle">{t.minSalesHint}</span>
              </label>
            )}

            <fieldset>
              <legend className="text-sm font-medium text-fg-2">{t.priceRange}</legend>
              <div className="mt-1.5 flex items-center gap-2">
                <input name="priceMin" type="number" min={0} step="0.01" placeholder={t.priceMin} aria-label={t.priceMin} className="input py-2" />
                <span className="text-subtle">–</span>
                <input name="priceMax" type="number" min={0} step="0.01" placeholder={t.priceMax} aria-label={t.priceMax} className="input py-2" />
              </div>
            </fieldset>

            {/* Catégories (catalogue) */}
            {mode === "CATALOG" && (
              <fieldset>
                <legend className="flex w-full items-center justify-between text-sm font-medium text-fg-2">
                  <span>{t.categories}</span>
                  {categories.length > 0 && (
                    <button type="button" onClick={() => setCategories([])} className="text-xs font-normal text-brand-300 hover:underline">{t.categoriesClear}</button>
                  )}
                </legend>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {CATEGORY_IDS.map((id) => {
                    const on = categories.includes(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleCategory(id)}
                        className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${on ? "bg-brand-500/20 text-fg ring-1 ring-brand-500/50" : "bg-surface-2 text-muted ring-1 ring-line hover:text-fg"}`}
                      >
                        {on ? "✓ " : ""}{t.categoryNames[id]}
                      </button>
                    );
                  })}
                </div>
                <span className="mt-1.5 block text-xs text-subtle">{categories.length ? fmt(t.categoriesCount, { n: categories.length }) : t.categoriesHint}</span>
              </fieldset>
            )}

            <label className="block text-sm font-medium text-fg-2">
              {mode === "CATALOG" ? t.themes : t.keywords}
              <textarea
                key={mode}
                name="seeds"
                rows={4}
                required={mode === "KEYWORDS"}
                placeholder={mode === "CATALOG" ? t.themesPlaceholder : t.keywordsPlaceholder}
                className="input mt-1.5 py-2 font-normal"
              />
              <span className="mt-1.5 block text-xs font-normal text-subtle">{mode === "CATALOG" ? t.themesHint : t.keywordsHint}</span>
            </label>

            {/* Mise en vente automatique */}
            <div className="rounded-xl border border-line bg-surface-2 p-4">
              <label className="flex cursor-pointer items-start gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoList}
                  onClick={() => setAutoList((v) => !v)}
                  disabled={accounts.length === 0}
                  className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition disabled:opacity-40 ${autoList ? "bg-brand-500" : "bg-surface-3 ring-1 ring-line-strong"}`}
                >
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${autoList ? "left-[22px]" : "left-0.5"}`} />
                </button>
                <span>
                  <span className="block text-sm font-semibold text-fg">{t.autoList}</span>
                  <span className="mt-0.5 block text-xs text-muted">{accounts.length ? t.autoListHint : errors.EBAY_NOT_CONNECTED}</span>
                </span>
              </label>
              {autoList && accounts.length > 1 && (
                <label className="mt-3 block text-sm font-medium text-fg-2">
                  {t.account}
                  <select name="ebayAccountId" className="input mt-1.5 py-2">
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                  </select>
                </label>
              )}
            </div>

            {error && <Notice tone="red">{error}</Notice>}
            <button disabled={starting || !cjConnected} className="btn-primary w-full sm:w-auto">
              <Icon name="zap" className="h-4 w-4" />
              {starting ? t.launching : t.launch}
            </button>
          </form>

          {/* Explication */}
          <aside className="card space-y-4">
            <h2 className="font-semibold text-fg">{t.howTitle}</h2>
            <ol className="space-y-3">
              {[t.how1, t.how2, t.how3, t.how4].map((s, i) => (
                <li key={i} className="flex gap-3 text-sm text-muted">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-500/15 text-xs font-semibold text-brand-200">{i + 1}</span>
                  {s}
                </li>
              ))}
            </ol>
            <p className="flex items-start gap-2 rounded-lg bg-emerald-500/10 p-3 text-xs text-emerald-200">
              <Icon name="shield" className="mt-0.5 h-4 w-4 shrink-0" />
              {t.compliance}
            </p>
          </aside>
        </div>
      )}

      {run && (
        <>
          {/* Progression */}
          <section className="card relative overflow-hidden">
            {running && <div className="pointer-events-none absolute -top-20 right-10 h-40 w-72 rounded-full bg-brand-500/15 blur-3xl" aria-hidden="true" />}
            <div className="relative flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className={`grid h-10 w-10 place-items-center rounded-xl ${running ? "bg-brand-500/15 text-brand-200" : run.status === "DONE" ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>
                  {running ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Icon name={run.status === "DONE" ? "check" : "pause"} className="h-5 w-5" />}
                </span>
                <div>
                  <p className="font-semibold text-fg">{t[`status${run.status}` as "statusRUNNING"]}</p>
                  <p className="text-xs text-subtle">{markets[run.marketId]} · {run.mode === "CATALOG" ? t.modeCatalog : t.modeKeywords}{run.minProfit != null && <> · <span className="font-medium text-amber-300">{t.highTicketBadge}</span></>}{run.minMonthlySales != null && <> · <span className="font-medium text-fg-2">{fmt(t.minSalesBadge, { n: run.minMonthlySales })}</span></>}</p>
                  {(run.categories.length > 0 || run.costMin != null || run.costMax != null) && (
                    <p className="mt-0.5 text-xs text-subtle">
                      {run.categories.map((c) => t.categoryNames[c as CategoryId] ?? c).join(", ")}
                      {run.categories.length > 0 && (run.costMin != null || run.costMax != null) ? " · " : ""}
                      {(run.costMin != null || run.costMax != null) && fmt(t.costRangeBadge, { min: run.costMin != null ? money(run.costMin) : "—", max: run.costMax != null ? money(run.costMax) : "—" })}
                    </p>
                  )}
                </div>
              </div>
              {running && <button onClick={stop} className="btn-secondary px-4 py-2 text-sm">{t.stop}</button>}
            </div>
            <div className="relative mt-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-semibold text-fg">{fmt(t.progress, { found: run.found, target: run.target })}</span>
                <span className="text-muted">
                  {fmt(t.scanned, { scanned: run.scanned })}
                  {run.listed > 0 && <> · <span className="text-emerald-300">{fmt(t.listedCount, { n: run.listed })}</span></>}
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-3">
                <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-fuchsia-500 transition-all duration-700" style={{ width: `${Math.min(100, (run.found / Math.max(1, run.target)) * 100)}%` }} />
              </div>
              {running && <p className="mt-3 text-xs text-subtle">{t.background}</p>}
              {run.pausedUntil && (
                <p className="mt-3 text-xs text-amber-300">
                  {fmt(t.quotaPaused, { time: new Date(run.pausedUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) })}
                </p>
              )}
              {run.error && run.error !== "EBAY_QUOTA" && run.status !== "FAILED" && <p className="mt-3 text-xs text-amber-300">{fmt(t.autoListStopped, { reason: fmt(errorMessage(errors, run.error), { detail: "" }) })}</p>}
              {run.status === "FAILED" && <p className="mt-3 text-xs text-red-300">{errorMessage(errors, run.error)}</p>}
              {!running && run.mode === "CATALOG" && run.found < run.target && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3">
                  <p className="text-sm text-muted">{run.exhausted ? t.exhaustedNote : fmt(t.limitReached, { scanned: run.scanned })}</p>
                  {!run.exhausted && (
                    <button onClick={keepSearching} disabled={continuing} className="btn-primary shrink-0 px-4 py-2 text-sm">
                      {continuing ? "…" : t.continueSearch}
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Résultats */}
          <section className="space-y-4">
            <div className="inline-flex rounded-xl border border-line bg-surface p-1 text-sm">
              {([["good", t.tabProfitable, good.length], ["bad", t.tabRejected, bad.length]] as const).map(([id, label, n]) => (
                <button key={id} onClick={() => setTab(id)} className={`rounded-lg px-3 py-1.5 font-medium transition ${tab === id ? "bg-surface-3 text-fg" : "text-muted hover:text-fg"}`}>
                  {label} <span className={`ml-1 tabular-nums ${tab === id ? "text-brand-300" : "text-subtle"}`}>{n}</span>
                </button>
              ))}
            </div>

            {(tab === "good" ? good : bad).length > 1 && (
              <label className="ml-3 inline-flex items-center gap-2 text-sm text-muted">
                {t.card.sortBy}
                <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="input w-auto py-1.5 text-sm">
                  <option value="profit">{t.card.sortProfit}</option>
                  <option value="margin">{t.card.sortMargin}</option>
                  <option value="price">{t.card.sortPrice}</option>
                </select>
              </label>
            )}

            {tab === "good" && good.length === 0 && (
              <p className="rounded-2xl border border-dashed border-line-strong bg-surface/50 p-10 text-center text-sm text-muted">{t.noResults}</p>
            )}
            {saveError && <p className="text-sm text-red-300" role="alert">{saveError}</p>}
            {(tab === "good" ? good : bad).length > 0 && (
              <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
                {sorted(tab === "good" ? good : bad).map((c) => (
                  <SniperProductCard
                    key={c.id}
                    c={c}
                    t={t}
                    minMargin={run?.minMarginPct ?? minMargin}
                    money={money}
                    reason={c.reason ? reasonText(c) : null}
                    onCreate={setEditing}
                    collapsible={tab === "bad"}
                    marketId={run?.marketId ?? defaultMarket}
                    saved={isSaved(c)}
                    onToggleSave={(x) => { setSaveError(null); toggleSaved(x); }}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {editing && editing.productId && editing.supplier && run && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:p-8" role="dialog" aria-modal="true">
          <div className="mx-auto max-w-4xl">
            <ListingEditor
              t={tl}
              errors={errors}
              markets={markets}
              accounts={accounts}
              hasGpsr={hasGpsr}
              keyword={editing.keyword}
              marketId={run.marketId}
              supplierRef={{ supplier: editing.supplier, productId: editing.productId, variantId: editing.variantId ?? undefined }}
              onClose={() => setEditing(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
