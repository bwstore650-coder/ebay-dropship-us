import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { isAdminEmail, parseAdminEmails } from "@/lib/admin";
import { env } from "@/lib/env";
import { getAppToken } from "@/lib/ebay";
import { priceTable, stripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";

/**
 * Diagnostic des clés (admin uniquement) : dit si eBay et Stripe acceptent les clés configurées,
 * sans jamais renvoyer une clé — seulement leur forme (préfixe, longueur).
 */
export async function GET() {
  const user = await currentUser();
  if (!user || !isAdminEmail(user.email, parseAdminEmails(process.env.ADMIN_EMAILS)))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const e = env();
  const secret = e.EBAY_CLIENT_SECRET;

  const ebay: Record<string, unknown> = {
    env: e.EBAY_ENV,
    clientIdIsProduction: e.EBAY_CLIENT_ID.includes("-PRD-"),
    secretPrefix: secret.slice(0, 4),
    secretLength: secret.length,
  };
  try {
    await getAppToken();
    ebay.ok = true;
  } catch (err) {
    ebay.ok = false;
    ebay.error = String(err).slice(0, 200);
  }

  const key = e.STRIPE_SECRET_KEY;
  const s: Record<string, unknown> = { keyType: key.slice(0, 8), webhookSecretSet: e.STRIPE_WEBHOOK_SECRET.startsWith("whsec_") };
  try {
    const prices = await Promise.all(
      Object.entries(priceTable()).flatMap(([plan, ids]) =>
        Object.entries(ids).map(async ([interval, id]) => {
          const p = await stripe().prices.retrieve(id);
          return `${plan}/${interval}=${(p.unit_amount ?? 0) / 100}${p.active ? "" : " (inactive)"}`;
        }),
      ),
    );
    s.ok = true;
    s.prices = prices;
  } catch (err) {
    s.ok = false;
    s.error = String(err).slice(0, 200);
  }

  return NextResponse.json({ ebay, stripe: s });
}
