import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { stripe } from "@/lib/stripe";

/** Portail client Stripe : changer de formule, carte, annuler. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user?.stripeCustomerId) return NextResponse.redirect(new URL("/billing", req.url), 303);
  const s = await stripe().billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${env().APP_URL}/billing`,
  });
  return NextResponse.redirect(s.url, 303);
}
