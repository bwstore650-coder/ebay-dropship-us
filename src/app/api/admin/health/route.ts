import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { isAdminEmail, parseAdminEmails } from "@/lib/admin";
import { env } from "@/lib/env";
import { getAppToken, getBrowseQuota } from "@/lib/ebay";
import { quotaPausedUntil } from "@/lib/ebay-quota";
import { priceTable, stripe } from "@/lib/stripe";
import { poolStats } from "@/lib/product-pool";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import * as cj from "@/lib/suppliers/cj";

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
    // Quota du jour de l'API Browse (recherches) et pause éventuelle.
    ebay.browseQuota = await getBrowseQuota().catch((x) => `error: ${String(x).slice(0, 150)}`);
    ebay.pausedUntil = (await quotaPausedUntil())?.toISOString() ?? null;
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

  // Compte CJ de l'admin : solde lisible ? (sert aux alertes « solde bas » de l'extension)
  const cjAcc = user.supplierAccounts.find((a) => a.supplier === "CJ");
  const cjInfo: Record<string, unknown> = { connected: Boolean(cjAcc) };
  if (cjAcc) {
    try {
      cjInfo.balance = await cj.getBalance(decrypt(cjAcc.accessToken));
    } catch (err) {
      cjInfo.error = String(err).slice(0, 300);
    }
  }
  const pool = { ...(await poolStats("EBAY_US")), cursor: await db.scanCursor.findUnique({ where: { marketplace: "EBAY_US" } }), trends: await db.trendItem.count() };
  return NextResponse.json({ ebay, stripe: s, cj: cjInfo, pool });
}
