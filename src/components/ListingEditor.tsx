"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fmt, type Dict } from "@/lib/i18n";
import { errorMessage } from "@/lib/i18n/errors";
import { computeMargin } from "@/lib/margin";
import { marketplace, type MarketplaceId } from "@/lib/marketplaces";
import { cleanTitle, isEuMarket, TITLE_MAX } from "@/lib/listing";
import type { ListingDraft } from "@/lib/listing-service";

type Ref = ListingDraft["ref"];
interface Account { id: string; label: string }
interface Policy { id: string; name: string }
interface SetupState { policies: { fulfillment: Policy[]; payment: Policy[]; returns: Policy[] }; existing: unknown | null }

const POLICIES_URL: Partial<Record<MarketplaceId, string>> = {
  EBAY_US: "https://www.ebay.com/bp/manage", EBAY_CA: "https://www.ebay.ca/bp/manage", EBAY_GB: "https://www.ebay.co.uk/bp/manage",
  EBAY_AU: "https://www.ebay.com.au/bp/manage", EBAY_DE: "https://www.ebay.de/bp/manage", EBAY_FR: "https://www.ebay.fr/bp/manage",
  EBAY_IT: "https://www.ebay.it/bp/manage", EBAY_ES: "https://www.ebay.es/bp/manage", EBAY_IE: "https://www.ebay.ie/bp/manage",
};

const field = "mt-1 w-full input py-2 text-sm";

export default function ListingEditor({
  t, errors, markets, accounts, hasGpsr, keyword, marketId, supplierRef, onClose,
}: {
  t: Dict["listing"];
  errors: Dict["errors"];
  markets: Dict["markets"];
  accounts: Account[];
  hasGpsr: boolean;
  keyword: string;
  marketId: MarketplaceId;
  supplierRef: Ref;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ListingDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [description, setDescription] = useState("");
  const [aspects, setAspects] = useState<Record<string, string[]>>({});
  const [editHtml, setEditHtml] = useState(false);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [done, setDone] = useState<{ url: string } | null>(null);

  const showError = (data: { error?: string; detail?: string }) => setError(fmt(errorMessage(errors, data.error), { detail: data.detail ?? "" }));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/listings/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword, marketId, ref: supplierRef }),
      });
      const data = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (!res.ok) return showError(data);
      const d = data as ListingDraft;
      setDraft(d);
      setTitle(d.title);
      setPrice(d.suggestedPrice.toFixed(2));
      setQuantity(d.quantity);
      setDescription(d.descriptionHtml);
      setAspects(d.aspects);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, marketId, supplierRef.productId, supplierRef.variantId]);

  const loadSetup = useCallback(async () => {
    if (!accountId) return;
    setSetupLoading(true);
    const res = await fetch(`/api/ebay/setup?${new URLSearchParams({ accountId, marketId })}`);
    const data = await res.json().catch(() => ({}));
    setSetupLoading(false);
    if (!res.ok) return showError(data);
    setSetup(data as SetupState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, marketId]);

  useEffect(() => { if (draft) loadSetup(); }, [draft, loadSetup]);

  const m = marketplace(marketId);
  const money = (v: number) => `${v.toFixed(2)} ${m.symbol}`;
  const priceNum = Number(price.replace(",", "."));
  const margin = useMemo(
    () => (draft && priceNum > 0 ? computeMargin({ saleTotal: priceNum, supplierCost: draft.cost, market: m }) : null),
    [draft, priceNum, m],
  );
  const missing = draft ? draft.aspectDefs.filter((d) => d.required && !aspects[d.name]?.length).map((d) => d.name) : [];
  const tooLow = !!draft && !!margin && margin.marginPct < draft.minMarginPct;
  const needsGpsr = isEuMarket(marketId) && !hasGpsr;
  const ready = !!draft && !!setup?.existing && !tooLow && missing.length === 0 && !needsGpsr && title.trim().length >= 10 && !!accountId;

  async function publish() {
    if (!draft) return;
    setPublishing(true);
    setError(null);
    const res = await fetch("/api/listings/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ebayAccountId: accountId,
        marketId,
        ref: draft.ref,
        categoryId: draft.categoryId,
        title,
        descriptionHtml: description,
        aspects,
        price: priceNum,
        quantity,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setPublishing(false);
    if (!res.ok) return showError(data);
    setDone({ url: data.url });
  }

  if (done)
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6">
        <p className="text-lg font-semibold text-emerald-300">✓ {t.published}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <a href={done.url} target="_blank" rel="noopener noreferrer" className="btn-primary">{t.view}</a>
          <button type="button" onClick={onClose} className="btn-secondary">{t.another}</button>
        </div>
      </div>
    );

  if (!draft)
    return (
      <div className="card">
        {error ? <p className="text-red-400">{error}</p> : <p className="animate-pulse text-muted">{t.preparing}</p>}
      </div>
    );

  const brandish = (name: string) => ["brand", "marke", "marque", "marca"].includes(name.toLowerCase());
  const extraAspectNames = Object.keys(aspects).filter((n) => !draft.aspectDefs.some((d) => d.name === n));

  return (
    <div className="space-y-6 card">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold">{t.draftTitle}</h2>
        <span className="rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-muted">{markets[marketId]}</span>
      </div>

      {draft.copySource === "supplier" && <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-300">{t.aiFallback}</p>}
      {draft.vero && <p className="rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{fmt(t.veroWarning, { brand: draft.vero })}</p>}

      {/* Compte et réglages eBay */}
      {accounts.length === 0 ? (
        <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-300">
          {t.connectFirst} <Link href="/settings" className="font-semibold underline">{t.settingsLink}</Link>
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            {t.account}
            <select value={accountId} onChange={(e) => { setAccountId(e.target.value); setSetup(null); }} className={field}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </label>
          <div className="text-sm">
            <p className="font-medium">{t.category}</p>
            <p className="mt-2 text-muted">{draft.categoryName ?? draft.categoryId} <span className="text-subtle">#{draft.categoryId}</span></p>
          </div>
        </div>
      )}
      {accounts.length > 0 && setupLoading && !setup && <p className="text-sm text-muted">{t.loadingSetup}</p>}
      {setup && !setup.existing && (
        <SetupForm t={t} market={markets[marketId]} marketId={marketId} accountId={accountId} policies={setup.policies} onSaved={loadSetup} onError={showError} onRefresh={loadSetup} />
      )}
      {needsGpsr && (
        <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-300">
          {t.gpsrMissing} <Link href="/settings#gpsr" className="font-semibold underline">{t.settingsLink}</Link>
        </p>
      )}

      {/* Titre */}
      <label className="block text-sm font-medium">
        {t.titleLabel}
        <input value={title} maxLength={TITLE_MAX} onChange={(e) => setTitle(e.target.value)} onBlur={() => setTitle(cleanTitle(title))} className={field} />
        <span className={`mt-1 block text-xs ${title.length > TITLE_MAX ? "text-red-400" : "text-muted"}`}>{fmt(t.titleCount, { n: title.length })}</span>
      </label>

      {/* Prix, quantité, marge */}
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block text-sm font-medium">
          {fmt(t.price, { currency: draft.currency })}
          <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className={field} />
          <span className="mt-1 block text-xs text-muted">{fmt(t.priceHelp, { pct: draft.minMarginPct, min: money(draft.minPrice) })}</span>
        </label>
        <label className="block text-sm font-medium">
          {t.quantity}
          <input type="number" min={1} max={draft.maxQuantity} value={quantity} onChange={(e) => setQuantity(Math.max(1, Math.min(draft.maxQuantity, Number(e.target.value) || 1)))} className={field} />
        </label>
        <div className={`rounded-xl p-4 text-sm ${tooLow ? "bg-red-500/10 text-red-300" : "bg-emerald-500/10 text-emerald-300"}`}>
          {margin && <p className="font-semibold">{fmt(t.profit, { profit: money(margin.profit), pct: margin.marginPct })}</p>}
          {tooLow && <p className="mt-1">{fmt(t.tooLow, { pct: draft.minMarginPct, min: money(draft.minPrice) })}</p>}
        </div>
      </div>

      {/* Caractéristiques */}
      <div>
        <h3 className="text-sm font-semibold">{t.aspects}</h3>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {[...draft.aspectDefs].sort((a, b) => Number(b.required) - Number(a.required)).map((d) => (
            <label key={d.name} className="block text-sm">
              <span className="font-medium">{d.name}</span>
              {d.required && <span className="ml-1 text-xs text-red-400">({t.required})</span>}
              {brandish(d.name) ? (
                <input value={aspects[d.name]?.join(", ") ?? ""} readOnly className={`${field} bg-surface-2 text-muted`} />
              ) : d.mode === "SELECTION_ONLY" && d.values.length ? (
                <select
                  value={aspects[d.name]?.[0] ?? ""}
                  onChange={(e) => setAspects({ ...aspects, [d.name]: e.target.value ? [e.target.value] : [] })}
                  className={field}
                >
                  <option value="">{t.choose}</option>
                  {d.values.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              ) : (
                <input
                  value={aspects[d.name]?.join(", ") ?? ""}
                  onChange={(e) => setAspects({ ...aspects, [d.name]: e.target.value.split(d.multi ? "," : /$^/).map((v) => v.trim()).filter(Boolean) })}
                  list={d.values.length ? `vals-${d.name}` : undefined}
                  className={field}
                />
              )}
              {d.mode === "FREE_TEXT" && d.values.length > 0 && (
                <datalist id={`vals-${d.name}`}>{d.values.slice(0, 50).map((v) => <option key={v} value={v} />)}</datalist>
              )}
            </label>
          ))}
          {extraAspectNames.map((n) => (
            <label key={n} className="block text-sm">
              <span className="font-medium">{n}</span>
              <input value={aspects[n]?.join(", ") ?? ""} onChange={(e) => setAspects({ ...aspects, [n]: e.target.value.split(",").map((v) => v.trim()).filter(Boolean) })} className={field} />
            </label>
          ))}
        </div>
        {missing.length > 0 && <p className="mt-2 text-sm text-red-400">{fmt(t.missing, { names: missing.join(", ") })}</p>}
      </div>

      {/* Description */}
      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t.description}</h3>
          <button type="button" onClick={() => setEditHtml(!editHtml)} className="text-sm font-medium text-brand-400 hover:underline">
            {editHtml ? t.preview : t.edit}
          </button>
        </div>
        {editHtml ? (
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={12} className={`${field} font-mono text-xs`} />
        ) : (
          <iframe title={t.preview} sandbox="" srcDoc={`<meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;font-size:14px;color:#0f172a;margin:12px;line-height:1.5}</style>${description}`} className="mt-2 h-72 w-full rounded-lg border border-line" />
        )}
      </div>

      {/* Photos */}
      <div>
        <h3 className="text-sm font-semibold">{fmt(t.photos, { n: draft.images.length })}</h3>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-2">
          {draft.images.map((src) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={src} src={src} alt="" loading="lazy" className="h-20 w-20 flex-none rounded-lg border border-line object-cover" />
          ))}
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={publish} disabled={!ready || publishing} className="btn-primary">
          {publishing ? t.publishing : t.publish}
        </button>
        <button type="button" onClick={onClose} className="btn-secondary">{t.another}</button>
      </div>
    </div>
  );
}

function SetupForm({
  t, market, marketId, accountId, policies, onSaved, onError, onRefresh,
}: {
  t: Dict["listing"];
  market: string;
  marketId: MarketplaceId;
  accountId: string;
  policies: SetupState["policies"];
  onSaved: () => void;
  onError: (d: { error?: string; detail?: string }) => void;
  onRefresh: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const empty = !policies.fulfillment.length || !policies.payment.length || !policies.returns.length;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const f = new FormData(e.currentTarget);
    const res = await fetch("/api/ebay/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId,
        marketId,
        fulfillmentPolicyId: f.get("fulfillment"),
        paymentPolicyId: f.get("payment"),
        returnPolicyId: f.get("returns"),
        postalCode: f.get("postalCode"),
        city: f.get("city") || undefined,
        stateOrProvince: f.get("state") || undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return onError(data);
    onSaved();
  }

  const select = (name: "fulfillment" | "payment" | "returns", label: string) => (
    <label className="block text-sm font-medium">
      {label}
      {policies[name].length ? (
        <select name={name} required className={field}>
          {policies[name].map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      ) : (
        <span className="mt-1 block text-xs font-normal text-red-400">{t.noPolicies}</span>
      )}
    </label>
  );

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-brand-500/30 bg-brand-500/10 p-5">
      <div>
        <h3 className="font-semibold">{fmt(t.setupTitle, { market })}</h3>
        <p className="mt-1 text-sm text-muted">{t.setupHelp}</p>
        <a href={POLICIES_URL[marketId]} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-sm font-medium text-brand-300 underline">{t.policiesLink}</a>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {select("fulfillment", t.fulfillment)}
        {select("payment", t.payment)}
        {select("returns", t.returns)}
      </div>
      <div>
        <p className="text-sm font-medium">{t.location}</p>
        <p className="text-xs text-muted">{t.locationHelp}</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <input name="postalCode" required minLength={2} maxLength={12} placeholder={t.postalCode} aria-label={t.postalCode} className={field} />
          <input name="city" maxLength={60} placeholder={t.city} aria-label={t.city} className={field} />
          <input name="state" maxLength={60} placeholder={t.state} aria-label={t.state} className={field} />
        </div>
      </div>
      <div className="flex gap-3">
        <button disabled={saving || empty} className="btn-primary px-4 py-2 text-sm">{saving ? t.saving : t.saveSetup}</button>
        {empty && <button type="button" onClick={onRefresh} className="btn-secondary px-4 py-2 text-sm">{t.refresh}</button>}
      </div>
    </form>
  );
}
