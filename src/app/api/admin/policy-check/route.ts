import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { isAdminEmail, parseAdminEmails } from "@/lib/admin";
import { db } from "@/lib/db";
import { userToken } from "@/lib/ebay-account";

export const dynamic = "force-dynamic";

/** TEMPORAIRE (admin) : politiques enregistrées vs politiques du compte eBay. À supprimer. */
export async function GET() {
  const user = await currentUser();
  if (!user || !isAdminEmail(user.email, parseAdminEmails(process.env.ADMIN_EMAILS))) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const out = [];
  for (const a of user.ebayAccounts) {
    const setups = await db.ebayMarketSetup.findMany({ where: { ebayAccountId: a.id }, select: { marketplaceId: true, fulfillmentPolicyId: true, paymentPolicyId: true, returnPolicyId: true } });
    const token = await userToken(a);
    const get = async (p: string) => {
      const r = await fetch(`https://api.ebay.com/sell/account/v1/${p}?marketplace_id=EBAY_US`, { headers: { Authorization: `Bearer ${token}`, "Accept-Language": "en-US" } });
      return { status: r.status, body: JSON.parse(await r.text()) };
    };
    const f = await get("fulfillment_policy");
    out.push({
      setups,
      fulfillment: f.status === 200 ? (f.body.fulfillmentPolicies ?? []).map((x: Record<string, unknown>) => ({ id: x.fulfillmentPolicyId, name: x.name, handlingTime: x.handlingTime, shippingOptions: x.shippingOptions, categoryTypes: x.categoryTypes })) : f,
      payment: ((await get("payment_policy")).body.paymentPolicies ?? []).map((x: Record<string, unknown>) => ({ id: x.paymentPolicyId, name: x.name })),
      returns: ((await get("return_policy")).body.returnPolicies ?? []).map((x: Record<string, unknown>) => ({ id: x.returnPolicyId, name: x.name })),
    });
  }
  const last = await db.listing.findFirst({ where: { userId: user.id, errorMessage: { not: null } }, orderBy: { updatedAt: "desc" }, select: { sku: true, categoryId: true, errorMessage: true, price: true } });
  return NextResponse.json({ out, last });
}
