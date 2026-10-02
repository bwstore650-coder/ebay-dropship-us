"use client";
import { useState } from "react";
import { fmt, type Dict } from "@/lib/i18n";
import type { MarketplaceId } from "@/lib/marketplaces";

export interface Policy { id: string; name: string }
export interface SetupState { policies: { fulfillment: Policy[]; payment: Policy[]; returns: Policy[] }; existing: unknown | null }

const POLICIES_URL: Partial<Record<MarketplaceId, string>> = {
  EBAY_US: "https://www.ebay.com/bp/manage", EBAY_CA: "https://www.ebay.ca/bp/manage", EBAY_GB: "https://www.ebay.co.uk/bp/manage",
  EBAY_AU: "https://www.ebay.com.au/bp/manage", EBAY_DE: "https://www.ebay.de/bp/manage", EBAY_FR: "https://www.ebay.fr/bp/manage",
  EBAY_IT: "https://www.ebay.it/bp/manage", EBAY_ES: "https://www.ebay.es/bp/manage", EBAY_IE: "https://www.ebay.ie/bp/manage",
};

const field = "mt-1 w-full input py-2 text-sm";

/** Réglages eBay d'un pays (politiques de livraison, paiement, retours + lieu d'expédition), une fois par compte et par pays. */
export default function SetupForm({
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
  const [creating, setCreating] = useState(false);
  const empty = !policies.fulfillment.length || !policies.payment.length || !policies.returns.length;

  async function createPolicies() {
    setCreating(true);
    const res = await fetch("/api/ebay/policies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId, marketId }),
    });
    const data = await res.json().catch(() => ({}));
    setCreating(false);
    if (!res.ok) return onError(data);
    onRefresh();
  }

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
      {empty && (
        <div className="rounded-lg border border-line bg-surface-2 p-4">
          <button type="button" onClick={createPolicies} disabled={creating} className="btn-primary px-4 py-2 text-sm">
            {creating ? t.creatingPolicies : t.createPolicies}
          </button>
          <p className="mt-2 text-xs text-muted">{t.createPoliciesHelp}</p>
        </div>
      )}
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
