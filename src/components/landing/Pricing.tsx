"use client";
import { useState } from "react";
import Link from "next/link";
import { fmt, type Dict } from "@/lib/i18n";
import type { BillingInterval, PlanInfo } from "@/lib/plans";

/** Tarifs de la page d'accueil : bascule mensuel / annuel, boutons vers l'inscription. */
export default function Pricing({
  plans, t, tb, tp, perMonth,
}: {
  plans: PlanInfo[];
  t: Dict["landing"]["pricing"];
  tb: Dict["billing"];
  tp: Dict["plans"];
  perMonth: string;
}) {
  const [interval, setBilling] = useState<BillingInterval>("year");
  return (
    <div>
      <div className="flex justify-center">
        <div role="group" className="inline-flex rounded-full border border-line bg-surface p-1 text-sm shadow-sm">
          {(["month", "year"] as const).map((i) => (
            <button
              key={i}
              type="button"
              aria-pressed={interval === i}
              onClick={() => setBilling(i)}
              className={`rounded-full px-4 py-1.5 font-medium transition ${interval === i ? "bg-brand-600 text-white" : "text-muted hover:text-fg"}`}
            >
              {i === "month" ? tb.monthly : tb.yearly}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {plans.map((p) => {
          const popular = p.id === "PRO";
          const monthly = interval === "month" ? p.priceUsd : p.yearlyUsd / 12;
          return (
            <div
              key={p.id}
              className={`relative flex flex-col rounded-2xl border bg-surface p-6 shadow-sm ${popular ? "border-brand-500 ring-2 ring-brand-600" : "border-line"}`}
            >
              {popular && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand-600 px-3 py-1 text-xs font-semibold text-white">
                  {t.popular}
                </span>
              )}
              <h3 className="text-lg font-semibold">{tp[p.id]}</h3>
              <p className="mt-1 text-sm text-muted">{t.taglines[p.id]}</p>
              <p className="mt-5 flex items-baseline gap-1">
                <span className="text-4xl font-bold tracking-tight">${Number.isInteger(monthly) ? monthly : monthly.toFixed(2)}</span>
                <span className="text-muted">{perMonth}</span>
              </p>
              <p className="mt-1 min-h-5 text-xs text-muted">
                {interval === "year" ? fmt(tb.perYear, { price: p.yearlyUsd }) : " "}
              </p>
              <ul className="mt-5 flex-1 space-y-2 text-sm text-fg-2">
                {[
                  p.listingsPerMonth === null ? tp.unlimitedListings : fmt(tp.listings, { n: p.listingsPerMonth }),
                  p.autoOrdersPerMonth === null ? tp.unlimitedOrders : fmt(tp.orders, { n: p.autoOrdersPerMonth }),
                  p.maxEbayAccounts === 1 ? tp.accountsOne : fmt(tp.accountsMany, { n: p.maxEbayAccounts }),
                  p.aiPerMonth === null ? tp.unlimitedAi : fmt(tp.ai, { n: p.aiPerMonth.toLocaleString("en-US") }),
                  tp.marginFilter,
                ].map((line) => (
                  <li key={line} className="flex gap-2">
                    <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 flex-none text-emerald-400" fill="currentColor" aria-hidden="true">
                      <path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-8 8a1 1 0 01-1.4 0l-4-4a1 1 0 111.4-1.4L8 12.6l7.3-7.3a1 1 0 011.4 0z" clipRule="evenodd" />
                    </svg>
                    {line}
                  </li>
                ))}
              </ul>
              <Link href="/register" className={`mt-6 ${popular ? "btn-primary" : "btn-secondary"} w-full`}>
                {t.cta}
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
