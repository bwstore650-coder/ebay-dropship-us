import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { isAdminEmail, parseAdminEmails } from "@/lib/admin";
import { db } from "@/lib/db";
import { userToken } from "@/lib/ebay-account";

export const dynamic = "force-dynamic";

/** TEMPORAIRE (admin) : la fiche article et l'offre des derniers brouillons refusés existent-elles chez eBay ? À supprimer. */
export async function GET() {
  const user = await currentUser();
  if (!user || !isAdminEmail(user.email, parseAdminEmails(process.env.ADMIN_EMAILS))) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const drafts = await db.listing.findMany({ where: { userId: user.id, status: "DRAFT" }, orderBy: { createdAt: "desc" }, take: 3, select: { sku: true, ebayAccountId: true, errorMessage: true, createdAt: true } });
  const out = [];
  for (const d of drafts) {
    const acc = user.ebayAccounts.find((a) => a.id === d.ebayAccountId);
    if (!acc) continue;
    const token = await userToken(acc);
    const h = { Authorization: `Bearer ${token}`, "Accept-Language": "en-US", "Content-Language": "en-US" };
    const item = await fetch(`https://api.ebay.com/sell/inventory/v1/inventory_item/${encodeURIComponent(d.sku)}`, { headers: h });
    const offers = await fetch(`https://api.ebay.com/sell/inventory/v1/offer?${new URLSearchParams({ sku: d.sku, marketplace_id: "EBAY_US" })}`, { headers: h });
    out.push({ ...d, item: { status: item.status, body: (await item.text()).slice(0, 700) }, offers: { status: offers.status, body: (await offers.text()).slice(0, 1200) } });
  }
  return NextResponse.json(out);
}
