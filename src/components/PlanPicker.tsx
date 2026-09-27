"use client";
import { useState } from "react";
import type { BillingInterval, PlanInfo } from "@/lib/plans";

export default function PlanPicker({ plans, currentPlan, trialDays, trialEligible }: { plans: PlanInfo[]; currentPlan: string; trialDays: number; trialEligible: boolean }) {
  const [interval, setBilling] = useState<BillingInterval>("year");
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(plan: string) {
    setLoading(plan);
    setError(null);
    const res = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan, interval }),
    });
    const data = await res.json();
    if (data.url) window.location.href = data.url;
    else { setError(data.error ?? "Erreur"); setLoading(null); }
  }

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1 text-sm">
        {(["month", "year"] as const).map((i) => (
          <button key={i} onClick={() => setBilling(i)} className={`rounded-md px-3 py-1 ${interval === i ? "bg-blue-600 text-white" : ""}`}>
            {i === "month" ? "Mensuel" : "Annuel (−25 %)"}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {plans.map((p) => (
          <div key={p.id} className={`rounded-xl border bg-white p-6 ${currentPlan === p.id ? "border-blue-600" : "border-slate-200"}`}>
            <h2 className="font-semibold">{p.name}</h2>
            <p className="mt-1 text-2xl font-bold">
              {interval === "month" ? `${p.priceUsd} $/mois` : `${p.yearlyUsd} $/an`}
            </p>
            {interval === "year" && <p className="text-xs text-slate-500">soit {(p.yearlyUsd / 12).toFixed(2)} $/mois</p>}
            <p className="mt-2 text-sm text-slate-600">
              {p.listingsPerMonth ?? "Illimité"} annonces · {p.autoOrdersPerMonth ?? "Illimité"} commandes auto ·{" "}
              {p.maxEbayAccounts} compte{p.maxEbayAccounts > 1 ? "s" : ""} eBay
            </p>
            {currentPlan === "NONE" && (
              <button onClick={() => choose(p.id)} disabled={loading !== null} className="mt-4 w-full rounded-lg bg-blue-600 py-2 font-semibold text-white disabled:opacity-60">
                {loading === p.id ? "…" : trialEligible ? `Essai gratuit ${trialDays} jours` : "Choisir cette formule"}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
