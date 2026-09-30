import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { exchangeCode, SELLER_SCOPES } from "@/lib/ebay";
import { maxEbayAccounts } from "@/lib/plans";

/** URL de retour à déclarer comme « Auth accepted URL » du RuName eBay. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));

  const jar = await cookies();
  const expected = jar.get("ebay_oauth_state")?.value;
  jar.delete("ebay_oauth_state");
  const code = url.searchParams.get("code");
  if (!code || !expected || url.searchParams.get("state") !== expected)
    return NextResponse.redirect(new URL("/settings?ebay=error", req.url));

  let t: Awaited<ReturnType<typeof exchangeCode>>;
  try {
    t = await exchangeCode(code);
  } catch (e) {
    console.error("eBay OAuth", e);
    return NextResponse.redirect(new URL("/settings?ebay=error", req.url));
  }
  const now = Date.now();
  const data = {
    accessToken: encrypt(t.access_token),
    accessTokenExpires: new Date(now + t.expires_in * 1000),
    refreshToken: encrypt(t.refresh_token ?? ""),
    refreshTokenExpires: new Date(now + (t.refresh_token_expires_in ?? 0) * 1000),
    scopes: SELLER_SCOPES.join(" "),
  };
  // Reconnexion d'un compte existant (?account=… passé dans l'état) ou ajout dans la limite de la formule.
  const reconnectId = jar.get("ebay_reconnect")?.value;
  jar.delete("ebay_reconnect");
  const existing = reconnectId ? user.ebayAccounts.find((a: { id: string }) => a.id === reconnectId) : undefined;
  if (existing) {
    await db.ebayAccount.update({ where: { id: existing.id }, data });
  } else if (user.ebayAccounts.length < maxEbayAccounts(user.plan)) {
    await db.ebayAccount.create({ data: { userId: user.id, ...data } });
  } else {
    return NextResponse.redirect(new URL("/settings?ebay=limit", req.url));
  }
  return NextResponse.redirect(new URL("/settings?ebay=connected", req.url));
}
