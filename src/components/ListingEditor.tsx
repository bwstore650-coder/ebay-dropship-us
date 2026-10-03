"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fmt, type Dict } from "@/lib/i18n";
import { errorMessage } from "@/lib/i18n/errors";
import { computeMargin } from "@/lib/margin";
import { marketplace, type MarketplaceId } from "@/lib/marketplaces";
import { cleanTitle, isEuMarket, TITLE_MAX } from "@/lib/listing";
import type { ListingDraft } from "@/lib/listing-service";
import EbaySetupForm, { type SetupState } from "@/components/EbaySetupForm";
import { AiTitlePicker, AiUsageLine } from "@/components/ai/AiTitlePicker";
import { useAiGenerate } from "@/components/ai/useAiGenerate";

type Ref = ListingDraft["ref"];
interface Account { id: string; label: string }


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
  const [titleIdeas, setTitleIdeas] = useState<string[]>([]);
  // Annonce à variantes : chaque variante (taille, couleur, lot…) avec son prix et sa quantité.
  const [vrows, setVrows] = useState<{ variantId: string; include: boolean; price: string; quantity: number }[]>([]);
  const [mainVariant, setMainVariant] = useState<string | null>(null);
  const ai = useAiGenerate(null);
  const ta = t.ai;

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
      setTitleIdeas(d.copySource === "ai" ? d.titles : []);
      setVrows((d.variants ?? []).map((v) => ({ variantId: v.variantId, include: true, price: v.suggestedPrice.toFixed(2), quantity: v.quantity })));
      ai.setUsage(d.ai.configured ? d.ai : null);
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
  const included = vrows.filter((r) => r.include);
  const useVariants = included.length >= 2;
  const variantMargin = (variantId: string, priceText: string) => {
    const v = draft?.variants.find((x) => x.variantId === variantId);
    const p = Number(priceText.replace(",", "."));
    return v && p > 0 ? computeMargin({ saleTotal: p, supplierCost: v.cost, market: m }) : null;
  };
  const variantsTooLow = useVariants && included.some((r) => (variantMargin(r.variantId, r.price)?.marginPct ?? -1) < (draft?.minMarginPct ?? 0));
  const varying = new Set(useVariants ? (draft?.variationNames ?? []).map((n) => n.toLowerCase()) : []);
  const missing = draft ? draft.aspectDefs.filter((d) => d.required && !aspects[d.name]?.length && !varying.has(d.name.toLowerCase())).map((d) => d.name) : [];
  const tooLow = useVariants ? variantsTooLow : !!draft && !!margin && margin.marginPct < draft.minMarginPct;
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
        ref: useVariants ? { ...draft.ref, variantId: included[0].variantId } : draft.ref,
        categoryId: draft.categoryId,
        title,
        descriptionHtml: description,
        aspects,
        price: useVariants ? Number(included[0].price.replace(",", ".")) : priceNum,
        quantity: useVariants ? included[0].quantity : quantity,
        keyword: keyword.slice(0, 120),
        ...(useVariants ? {
          variants: included.map((r) => ({ variantId: r.variantId, price: Number(r.price.replace(",", ".")), quantity: r.quantity })),
          // Variante principale : celle choisie si elle est cochée, sinon la première cochée.
          mainVariantId: included.some((r) => r.variantId === mainVariant) ? mainVariant : included[0]?.variantId,
        } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    setPublishing(false);
    if (!res.ok) {
      // Politiques eBay à rechoisir (disparues du compte) : le formulaire des réglages réapparaît.
      if (data?.error === "EBAY_SETUP_REQUIRED") loadSetup();
      return showError(data);
    }
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

      {draft.copySource === "ai" ? (
        <p className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-brand-500/10 p-3 text-sm text-brand-200">
          <span>✦ {ta.writtenByAi}</span>
          <AiUsageLine t={ta} usage={ai.usage} />
        </p>
      ) : (
        <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-300">
          {draft.ai.note === "AI_LIMIT" ? fmt(ta.limitNote, { limit: draft.ai.limit.toLocaleString() }) : draft.ai.note === "AI_FAILED" ? ta.failedNote : t.aiFallback}
        </p>
      )}
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
        <EbaySetupForm t={t} market={markets[marketId]} marketId={marketId} accountId={accountId} policies={setup.policies} onSaved={loadSetup} onError={showError} onRefresh={loadSetup} />
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
      {draft.ai.configured && (titleIdeas.length > 0 || draft.ai.note !== "AI_LIMIT") && (
        <AiTitlePicker
          t={ta}
          titles={titleIdeas}
          current={title}
          onPick={setTitle}
          busy={ai.busy === "titles"}
          onRegenerate={async () => {
            const r = await ai.run("titles", { ...draft.aiContext, currentTitle: title || undefined });
            if (r) setTitleIdeas(r.titles);
          }}
        />
      )}
      {ai.error && <p className="text-sm text-red-400">{errorMessage(errors, ai.error)}</p>}

      {/* Variantes (tailles, couleurs, lots…) : une seule annonce eBay */}
      {vrows.length >= 2 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">{fmt(t.variantsTitle, { n: included.length, total: vrows.length })}</h3>
            <span className="text-xs text-muted">{draft.variationNames.join(" · ")}</span>
          </div>
          <p className="text-xs text-muted">{fmt(t.variantsHelp, { pct: draft.minMarginPct })}</p>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="border-b border-line text-xs text-subtle">
                <tr>
                  <th className="px-3 py-2 font-medium" />
                  <th className="px-3 py-2 font-medium">{t.variantCol}</th>
                  <th className="px-3 py-2 font-medium">{t.variantStock}</th>
                  <th className="px-3 py-2 font-medium">{fmt(t.price, { currency: draft.currency })}</th>
                  <th className="px-3 py-2 font-medium">{t.quantity}</th>
                  <th className="px-3 py-2 font-medium">{t.variantProfit}</th>
                  <th className="px-3 py-2 font-medium" title={t.variantMainHelp}>{t.variantMain}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {vrows.map((r, i) => {
                  const v = draft.variants.find((x) => x.variantId === r.variantId)!;
                  const mg = variantMargin(r.variantId, r.price);
                  const low = r.include && (!mg || mg.marginPct < draft.minMarginPct);
                  const set = (patch: Partial<typeof r>) => setVrows((rows) => rows.map((x, k) => (k === i ? { ...x, ...patch } : x)));
                  const firstIncluded = vrows.find((x) => x.include)?.variantId;
                  const isMain = r.include && (mainVariant && vrows.some((x) => x.include && x.variantId === mainVariant) ? mainVariant === r.variantId : firstIncluded === r.variantId);
                  return (
                    <tr key={r.variantId} className={r.include ? "" : "opacity-50"}>
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={r.include} onChange={(e) => set({ include: e.target.checked })} aria-label={v.label} />
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-2">
                          {v.image && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={v.image} alt="" className="h-8 w-8 shrink-0 rounded bg-white object-contain" />
                          )}
                          <span className="text-fg-2">{Object.values(v.options).join(" · ")}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2 tabular-nums text-muted">{v.stock}</td>
                      <td className="px-3 py-2">
                        <input inputMode="decimal" value={r.price} onChange={(e) => set({ price: e.target.value })} disabled={!r.include} className="input w-24 py-1 text-sm tabular-nums" aria-label={`${t.variantCol} ${v.label}`} />
                        <span className="mt-0.5 block text-[11px] text-subtle">{fmt(t.variantMin, { min: money(v.minPrice) })}</span>
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" min={1} max={Math.min(10, v.stock)} value={r.quantity} disabled={!r.include}
                          onChange={(e) => set({ quantity: Math.max(1, Math.min(10, v.stock, Number(e.target.value) || 1)) })} className="input w-16 py-1 text-sm" aria-label={t.quantity} />
                      </td>
                      <td className={`px-3 py-2 text-xs font-medium tabular-nums ${low ? "text-red-300" : "text-emerald-300"}`}>
                        {mg ? `${money(mg.profit)} · ${mg.marginPct} %` : "—"}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input type="radio" name="mainVariant" checked={isMain} disabled={!r.include} onChange={() => setMainVariant(r.variantId)} aria-label={`${t.variantMain} : ${v.label}`} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!useVariants && <p className="text-xs text-amber-300">{t.variantsSingle}</p>}
          {variantsTooLow && <p className="text-xs text-red-300">{fmt(t.variantsTooLow, { pct: draft.minMarginPct })}</p>}
        </div>
      )}

      {(draft.variantsUnavailable ?? []).length > 0 && (
        <details className="rounded-lg border border-line bg-surface-2/40 px-3 py-2 text-xs text-muted">
          <summary className="cursor-pointer select-none">{fmt(t.variantsUnavailable, { n: draft.variantsUnavailable.length })}</summary>
          <ul className="mt-2 space-y-0.5">
            {draft.variantsUnavailable.map((v, i) => (
              <li key={`${v.label}-${i}`} className="flex justify-between gap-3">
                <span className="text-fg-2">{v.label}</span>
                <span className="text-subtle">{t.variantReasons[v.reason]}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Prix, quantité, marge */}
      {!useVariants && <div className="grid gap-4 sm:grid-cols-3">
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
      </div>}

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
          <span className="flex items-center gap-4">
            {draft.ai.configured && (
              <button
                type="button"
                disabled={ai.busy === "description"}
                onClick={async () => {
                  const r = await ai.run("description", { ...draft.aiContext });
                  if (r) setDescription(r.descriptionHtml);
                }}
                className="text-sm font-medium text-brand-300 hover:underline disabled:opacity-60"
              >
                ✦ {ai.busy === "description" ? ta.writing : ta.rewriteDescription}
              </button>
            )}
            <button type="button" onClick={() => setEditHtml(!editHtml)} className="text-sm font-medium text-brand-400 hover:underline">
              {editHtml ? t.preview : t.edit}
            </button>
          </span>
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
