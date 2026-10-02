import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { isAdminEmail, parseAdminEmails } from "@/lib/admin";
import { db } from "@/lib/db";
import { userToken } from "@/lib/ebay-account";

export const dynamic = "force-dynamic";

/** TEMPORAIRE (admin) : lieux d'expédition eBay enregistrés vs ceux qui existent chez eBay. À supprimer. */
export async function GET() {
  const user = await currentUser();
  if (!user || !isAdminEmail(user.email, parseAdminEmails(process.env.ADMIN_EMAILS))) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const out = [];
  for (const a of user.ebayAccounts) {
    const setups = await db.ebayMarketSetup.findMany({ where: { ebayAccountId: a.id } });
    let token: string | null = null;
    try { token = await userToken(a); } catch (e) { out.push({ account: a.id, tokenError: String(e).slice(0, 200) }); continue; }
    const list = await fetch("https://api.ebay.com/sell/inventory/v1/location?limit=100", { headers: { Authorization: `Bearer ${token}`, "Accept-Language": "en-US" } });
    const listText = await list.text();
    const checks = [];
    for (const s of setups) {
      const r = await fetch(`https://api.ebay.com/sell/inventory/v1/location/${encodeURIComponent(s.merchantLocationKey)}`, { headers: { Authorization: `Bearer ${token}`, "Accept-Language": "en-US" } });
      checks.push({ market: s.marketplaceId, key: s.merchantLocationKey, status: r.status, body: (await r.text()).slice(0, 600) });
    }
    out.push({ account: a.id, ebayUser: a.ebayUserId, setups: checks, locations: { status: list.status, body: listText.slice(0, 1500) } });
  }
  const drafts = await db.listing.findMany({ where: { userId: user.id, errorMessage: { contains: "Location" } }, select: { id: true, sku: true, marketplace: true, ebayAccountId: true, errorMessage: true, createdAt: true }, take: 5, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ out, drafts });
}
