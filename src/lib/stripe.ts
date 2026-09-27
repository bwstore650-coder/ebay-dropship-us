import Stripe from "stripe";
import type { Plan } from "@prisma/client";
import { env } from "@/lib/env";
import type { BillingInterval, PaidPlan } from "@/lib/plans";

let client: Stripe | null = null;
export function stripe() {
  if (!client) client = new Stripe(env().STRIPE_SECRET_KEY);
  return client;
}

export type PriceTable = Record<PaidPlan, Record<BillingInterval, string>>;

export function priceTable(): PriceTable {
  const e = env();
  return {
    STARTER: { month: e.STRIPE_PRICE_STARTER_MONTHLY, year: e.STRIPE_PRICE_STARTER_YEARLY },
    PRO: { month: e.STRIPE_PRICE_PRO_MONTHLY, year: e.STRIPE_PRICE_PRO_YEARLY },
    BUSINESS: { month: e.STRIPE_PRICE_BUSINESS_MONTHLY, year: e.STRIPE_PRICE_BUSINESS_YEARLY },
    AGENCY: { month: e.STRIPE_PRICE_AGENCY_MONTHLY, year: e.STRIPE_PRICE_AGENCY_YEARLY },
  };
}

export function priceIdFor(plan: PaidPlan, interval: BillingInterval, table: PriceTable = priceTable()): string {
  const id = table[plan][interval];
  if (!id) throw new Error(`Prix Stripe manquant pour ${plan} (${interval}) : vérifie les variables STRIPE_PRICE_*`);
  return id;
}

/** Retrouve la formule à partir d'un identifiant de prix Stripe (mensuel ou annuel). */
export function planForPrice(priceId: string | undefined, table: PriceTable = priceTable()): Plan {
  if (!priceId) return "NONE";
  for (const [plan, ids] of Object.entries(table) as [PaidPlan, Record<BillingInterval, string>][]) {
    if (ids.month === priceId || ids.year === priceId) return plan;
  }
  return "NONE";
}
