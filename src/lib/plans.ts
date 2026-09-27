import type { Plan } from "@prisma/client";

export interface PlanInfo {
  id: Exclude<Plan, "NONE">;
  name: string;
  priceUsd: number;
  listingsPerMonth: number | null; // null = illimité
  autoOrdersPerMonth: number | null;
}

export const PLANS: PlanInfo[] = [
  { id: "STARTER", name: "Starter", priceUsd: 29, listingsPerMonth: 50, autoOrdersPerMonth: 50 },
  { id: "PRO", name: "Pro", priceUsd: 59, listingsPerMonth: 300, autoOrdersPerMonth: 300 },
  { id: "BUSINESS", name: "Business", priceUsd: 99, listingsPerMonth: null, autoOrdersPerMonth: null },
];

export const TRIAL_DAYS = 7;
