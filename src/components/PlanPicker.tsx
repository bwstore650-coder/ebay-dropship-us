"use client";
import { useState } from "react";
import { fmt, type Dict } from "@/lib/i18n";
import { errorMessage } from "@/lib/i18n/errors";
import type { BillingInterval, PlanInfo } from "@/lib/plans";
import PlanFeatures from "@/components/PlanFeatures";

export default function PlanPicker({
  plans, currentPlan, trialDays, trialEligible, t, tPlans, errors,
}: {
  plans: PlanInfo[];
  currentPlan: string;
  trialDays: number;
  trialEligible: boolean;
  t: Dict["billing"];
  tPlans: Dict["plans"];
  errors: Dict["errors"];
}) {
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
    const data = await res.json().catch(() => ({}));
    if (data.url) window.location.href = data.url;
    else { setError(errorMessage(errors, data.error)); setLoading(null); }
  }

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border border-line-strong bg-surface p-1 text-sm">
        {(["month", "year"] as const).map((i) => (
          <button key={i} onClick={() => setBilling(i)} className={`rounded-md px-3 py-1 ${interval === i ? "bg-brand-600 text-white" : ""}`}>
            {i === "month" ? t.monthly : t.yearly}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {plans.map((p) => (
          <div key={p.id} className={`rounded-2xl border bg-surface p-6 shadow-sm ${currentPlan === p.id ? "border-brand-500" : "border-line"}`}>
            <h2 className="font-semibold">{tPlans[p.id]}</h2>
            <p className="mt-1 text-2xl font-bold">
              {interval === "month" ? fmt(t.perMonth, { price: p.priceUsd }) : fmt(t.perYear, { price: p.yearlyUsd })}
            </p>
            {interval === "year" && <p className="text-xs text-muted">{fmt(t.equivalent, { price: (p.yearlyUsd / 12).toFixed(2) })}</p>}
            <PlanFeatures plan={p} t={tPlans} />
            {currentPlan === "NONE" && (
              <button onClick={() => choose(p.id)} disabled={loading !== null} className="mt-4 w-full rounded-lg bg-brand-600 py-2 shadow-sm transition hover:bg-brand-500 font-semibold text-white disabled:opacity-60">
                {loading === p.id ? "…" : trialEligible ? fmt(t.startTrial, { days: trialDays }) : t.choose}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
