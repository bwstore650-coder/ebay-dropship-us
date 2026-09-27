import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { TRIAL_DAYS } from "@/lib/plans";
import { priceIdFor, stripe } from "@/lib/stripe";

const body = z.object({ plan: z.enum(["STARTER", "PRO", "BUSINESS"]) });

/** Crée une session Stripe Checkout (abonnement avec essai gratuit). */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  const parsed = body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Formule inconnue" }, { status: 400 });

  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const c = await stripe().customers.create({ email: user.email, metadata: { userId: user.id } });
    customerId = c.id;
    await db.user.update({ where: { id: user.id }, data: { stripeCustomerId: customerId } });
  }

  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceIdFor(parsed.data.plan), quantity: 1 }],
    subscription_data: user.plan === "NONE" ? { trial_period_days: TRIAL_DAYS } : undefined,
    allow_promotion_codes: true,
    success_url: `${env().APP_URL}/dashboard?billing=success`,
    cancel_url: `${env().APP_URL}/billing?billing=cancel`,
    client_reference_id: user.id,
  });
  return NextResponse.json({ url: session.url });
}
