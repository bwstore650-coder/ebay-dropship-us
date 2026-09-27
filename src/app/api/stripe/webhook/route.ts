import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { planForPrice, stripe } from "@/lib/stripe";

/** Webhook Stripe : tient la formule de chaque client à jour. */
export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature");
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(await req.text(), sig ?? "", env().STRIPE_WEBHOOK_SECRET);
  } catch {
    return NextResponse.json({ error: "Signature invalide" }, { status: 400 });
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const sub = event.data.object as Stripe.Subscription;
    const active = ["active", "trialing"].includes(sub.status);
    const item = sub.items.data[0];
    await db.user.updateMany({
      where: { stripeCustomerId: String(sub.customer) },
      data: {
        stripeSubscriptionId: sub.id,
        plan: active ? planForPrice(item?.price.id) : "NONE",
        trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
        currentPeriodEnd: item?.current_period_end ? new Date(item.current_period_end * 1000) : null,
      },
    });
  }
  return NextResponse.json({ received: true });
}
