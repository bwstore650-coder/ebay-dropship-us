import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { TRIAL_DAYS } from "@/lib/plans";
import { priceIdFor, stripe } from "@/lib/stripe";

const body = z.object({
  plan: z.enum(["STARTER", "PRO", "BUSINESS", "AGENCY"]),
  interval: z.enum(["month", "year"]).default("month"),
});

/** Crée une session Stripe Checkout (abonnement avec essai gratuit). */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });

  let priceId: string;
  try {
    priceId = priceIdFor(parsed.data.plan, parsed.data.interval);
  } catch (e) {
    console.error("Checkout", e);
    return NextResponse.json({ error: "CONFIG_MISSING" }, { status: 500 });
  }

  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const c = await stripe().customers.create({ email: user.email, metadata: { userId: user.id } });
    customerId = c.id;
    await db.user.update({ where: { id: user.id }, data: { stripeCustomerId: customerId } });
  }

  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    // Un seul essai gratuit par client (jamais après un premier abonnement).
    subscription_data: !user.trialEndsAt && !user.stripeSubscriptionId ? { trial_period_days: TRIAL_DAYS } : undefined,
    allow_promotion_codes: true,
    success_url: `${env().APP_URL}/dashboard?billing=success`,
    cancel_url: `${env().APP_URL}/billing?billing=cancel`,
    client_reference_id: user.id,
  });
  return NextResponse.json({ url: session.url });
}
