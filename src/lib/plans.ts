import type { Plan } from "@prisma/client";

export type PaidPlan = Exclude<Plan, "NONE">;
export type BillingInterval = "month" | "year";

export interface PlanInfo {
  id: PaidPlan;
  name: string;
  priceUsd: number;        // par mois
  yearlyUsd: number;       // par an (−25 %)
  listingsPerMonth: number | null; // null = illimité
  autoOrdersPerMonth: number | null;
  maxEbayAccounts: number;
}

export const YEARLY_DISCOUNT = 0.25;
const yearly = (monthly: number) => Math.round(monthly * 12 * (1 - YEARLY_DISCOUNT));

export const PLANS: PlanInfo[] = [
  { id: "STARTER", name: "Starter", priceUsd: 29, yearlyUsd: yearly(29), listingsPerMonth: 50, autoOrdersPerMonth: 50, maxEbayAccounts: 1 },
  { id: "PRO", name: "Pro", priceUsd: 59, yearlyUsd: yearly(59), listingsPerMonth: 300, autoOrdersPerMonth: 300, maxEbayAccounts: 1 },
  { id: "BUSINESS", name: "Business", priceUsd: 99, yearlyUsd: yearly(99), listingsPerMonth: null, autoOrdersPerMonth: null, maxEbayAccounts: 3 },
  { id: "AGENCY", name: "Agence", priceUsd: 249, yearlyUsd: yearly(249), listingsPerMonth: null, autoOrdersPerMonth: null, maxEbayAccounts: 10 },
];

export const TRIAL_DAYS = 7;

export function planInfo(plan: Plan): PlanInfo | null {
  return PLANS.find((p) => p.id === plan) ?? null;
}

/** Nombre de comptes eBay autorisés (1 pendant l'essai / sans formule, pour pouvoir tester). */
export function maxEbayAccounts(plan: Plan): number {
  return planInfo(plan)?.maxEbayAccounts ?? 1;
}
