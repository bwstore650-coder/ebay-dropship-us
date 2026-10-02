"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fmt, type Dict } from "@/lib/i18n";
import { errorMessage } from "@/lib/i18n/errors";
import type { MarketplaceId } from "@/lib/marketplaces";
import { CATEGORY_IDS, type CategoryId } from "@/lib/sniper";
import EbaySetupForm, { type SetupState } from "@/components/EbaySetupForm";
import { Icon } from "@/components/icons";

const COUNTS = [5, 10, 20] as const;
const MAX_CATEGORIES = 3;

/**
 * Démarrage rapide : abonnement → eBay → CJ → réglages eBay du pays → le Sniper trouve et publie N produits
 * rentables tout seul. But : des annonces en ligne pendant l'essai, sans devoir découvrir l'outil.
 */
export default function QuickStart({
  t, tl, ts, errors, marketId, marketName, account, hasPlan, hasCj, setupDone, running,
}: {
  t: Dict["dashboard"]["quick"];
  tl: Dict["listing"];
  ts: Dict["sniper"];
  errors: Dict["errors"];
  marketId: MarketplaceId;
  marketName: string;
  account: { id: string; label: string } | null;
  hasPlan: boolean;
  hasCj: boolean;
  setupDone: boolean;
  running: boolean;
}) {
  const router = useRouter();
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [doneSetup, setDoneSetup] = useState(setupDone);
  const [count, setCount] = useState<number>(10);
  const [categories, setCategories] = useState<CategoryId[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showError = (d: { error?: string; detail?: string }) => setError(fmt(errorMessage(errors, d.error ?? "UPSTREAM"), { detail: d.detail ?? "" }));

  async function openSetup() {
    if (!account) return;
    setSetupOpen(true);
    setError(null);
    const res = await fetch(`/api/ebay/setup?${new URLSearchParams({ accountId: account.id, marketId })}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return showError(data);
    if ((data as SetupState).existing) {
      setDoneSetup(true);
      setSetupOpen(false);
      return;
    }
    setSetup(data as SetupState);
  }

  async function launch() {
    if (!account) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/sniper", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "CATALOG", marketId, target: count, categories, autoList: true, ebayAccountId: account.id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      return showError(data);
    }
    router.push("/sniper");
  }

  const toggle = (id: CategoryId) =>
    setCategories((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= MAX_CATEGORIES ? c : [...c, id]));

  const steps = [
    { done: hasPlan, label: t.plan, href: "/billing" },
    { done: Boolean(account), label: t.ebay, href: "/settings" },
    { done: hasCj, label: t.cj, href: "/settings" },
  ];
  const ready = steps.every((s) => s.done);

  return (
    <div className="card space-y-4 border-brand-500/30">
      <div>
        <h2 className="flex items-center gap-2 font-semibold text-fg"><Icon name="zap" className="h-4 w-4 text-brand-300" />{t.title}</h2>
        <p className="mt-1 text-sm text-muted">{t.subtitle}</p>
      </div>

      <ol className="space-y-1">
        {steps.map((s, i) => (
          <li key={s.label}>
            {s.done ? (
              <span className="flex items-center gap-3 px-1 py-1 text-sm text-subtle line-through decoration-subtle/60">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-500/20 text-emerald-300"><Icon name="check" className="h-3 w-3" strokeWidth={3} /></span>
                {s.label}
              </span>
            ) : (
              <Link href={s.href} className="flex items-center gap-3 rounded-lg px-1 py-1 text-sm text-fg-2 hover:bg-surface-2 hover:text-fg">
                <span className="grid h-5 w-5 place-items-center rounded-full border-2 border-line-strong text-[10px] text-muted">{i + 1}</span>
                <span className="flex-1">{s.label}</span>
                <Icon name="arrowRight" className="h-3.5 w-3.5 text-subtle" />
              </Link>
            )}
          </li>
        ))}
        <li>
          {doneSetup ? (
            <span className="flex items-center gap-3 px-1 py-1 text-sm text-subtle line-through decoration-subtle/60">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-500/20 text-emerald-300"><Icon name="check" className="h-3 w-3" strokeWidth={3} /></span>
              {fmt(t.setup, { market: marketName })}
            </span>
          ) : (
            <button type="button" disabled={!account || setupOpen} onClick={openSetup} className="flex w-full items-center gap-3 rounded-lg px-1 py-1 text-left text-sm text-fg-2 hover:bg-surface-2 hover:text-fg disabled:opacity-60">
              <span className="grid h-5 w-5 place-items-center rounded-full border-2 border-line-strong text-[10px] text-muted">4</span>
              <span className="flex-1">{fmt(t.setup, { market: marketName })}</span>
            </button>
          )}
        </li>
      </ol>

      {setupOpen && !doneSetup && account && (
        setup ? (
          <EbaySetupForm
            t={tl}
            market={marketName}
            marketId={marketId}
            accountId={account.id}
            policies={setup.policies}
            onSaved={() => { setDoneSetup(true); setSetupOpen(false); }}
            onError={showError}
            onRefresh={openSetup}
          />
        ) : (
          <p className="text-sm text-muted">{tl.loadingSetup}</p>
        )
      )}

      {running ? (
        <Link href="/sniper" className="btn-primary w-full justify-center py-2.5 text-sm">{t.running}</Link>
      ) : (
        <div className={`space-y-3 rounded-xl border border-line bg-surface-2/40 p-3 ${ready && doneSetup ? "" : "pointer-events-none opacity-50"}`} aria-disabled={!(ready && doneSetup)}>
          <div>
            <p className="text-xs font-medium text-muted">{t.howMany}</p>
            <div className="mt-1.5 flex gap-1.5" role="group" aria-label={t.howMany}>
              {COUNTS.map((n) => (
                <button key={n} type="button" aria-pressed={count === n} onClick={() => setCount(n)}
                  className={`rounded-md px-3 py-1 text-xs font-semibold tabular-nums ${count === n ? "bg-brand-500/20 text-fg ring-1 ring-brand-500/50" : "bg-surface-3 text-muted hover:text-fg"}`}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-muted">{fmt(t.categories, { max: MAX_CATEGORIES })}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {CATEGORY_IDS.map((id) => {
                const on = categories.includes(id);
                return (
                  <button key={id} type="button" aria-pressed={on} onClick={() => toggle(id)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${on ? "bg-brand-500/20 text-fg ring-1 ring-brand-500/50" : "bg-surface-3 text-muted ring-1 ring-line hover:text-fg"}`}>
                    {on ? "✓ " : ""}{ts.categoryNames[id]}
                  </button>
                );
              })}
            </div>
          </div>
          <button type="button" onClick={launch} disabled={busy || !ready || !doneSetup} className="btn-primary w-full justify-center py-2.5 text-sm">
            {busy ? t.launching : fmt(t.launch, { n: count })}
          </button>
          <p className="text-[11px] text-subtle">{t.launchHelp}</p>
        </div>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
