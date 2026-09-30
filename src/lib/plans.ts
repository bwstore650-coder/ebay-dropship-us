import type { Plan } from "@prisma/client";

export type PaidPlan = Exclude<Plan, "NONE">;
export type BillingInterval = "month" | "year";

export interface PlanInfo {
  id: PaidPlan;
  priceUsd: number;        // par mois
  yearlyUsd: number;       // par an (−20 %)
  listingsPerMonth: number | null; // null = illimité
  autoOrdersPerMonth: number | null;
  maxEbayAccounts: number;
}

export const YEARLY_DISCOUNT = 0.2;
const yearly = (monthly: number) => Math.round(monthly * 12 * (1 - YEARLY_DISCOUNT));

export const PLANS: PlanInfo[] = [
  { id: "STARTER", priceUsd: 39, yearlyUsd: yearly(39), listingsPerMonth: 150, autoOrdersPerMonth: 150, maxEbayAccounts: 1 },
  { id: "PRO", priceUsd: 79, yearlyUsd: yearly(79), listingsPerMonth: 500, autoOrdersPerMonth: 500, maxEbayAccounts: 2 },
  { id: "BUSINESS", priceUsd: 149, yearlyUsd: yearly(149), listingsPerMonth: 3000, autoOrdersPerMonth: 3000, maxEbayAccounts: 5 },
  { id: "AGENCY", priceUsd: 299, yearlyUsd: yearly(299), listingsPerMonth: null, autoOrdersPerMonth: null, maxEbayAccounts: 15 },
];

/** Essai : 3 jours pour 0,99 $ (payés à l'inscription, non remboursables), puis la formule choisie. */
export const TRIAL_DAYS = 3;
export const TRIAL_FEE_CENTS = 99;

export function planInfo(plan: Plan): PlanInfo | null {
  return PLANS.find((p) => p.id === plan) ?? null;
}

/** Nombre de comptes eBay autorisés (1 pendant l'essai / sans formule, pour pouvoir tester). */
export function maxEbayAccounts(plan: Plan): number {
  return planInfo(plan)?.maxEbayAccounts ?? 1;
}
