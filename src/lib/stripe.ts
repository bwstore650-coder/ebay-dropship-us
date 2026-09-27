import Stripe from "stripe";
import { env } from "@/lib/env";
import type { Plan } from "@prisma/client";

let client: Stripe | null = null;
export function stripe() {
  if (!client) client = new Stripe(env().STRIPE_SECRET_KEY);
  return client;
}

export function priceIdFor(plan: Exclude<Plan, "NONE">): string {
  const e = env();
  return { STARTER: e.STRIPE_PRICE_STARTER, PRO: e.STRIPE_PRICE_PRO, BUSINESS: e.STRIPE_PRICE_BUSINESS }[plan];
}

export function planForPrice(priceId: string | undefined): Plan {
  const e = env();
  if (priceId === e.STRIPE_PRICE_STARTER) return "STARTER";
  if (priceId === e.STRIPE_PRICE_PRO) return "PRO";
  if (priceId === e.STRIPE_PRICE_BUSINESS) return "BUSINESS";
  return "NONE";
}
