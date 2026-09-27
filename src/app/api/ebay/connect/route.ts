import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "node:crypto";
import { currentUser } from "@/lib/auth";
import { authorizeUrl } from "@/lib/ebay";
import { maxEbayAccounts } from "@/lib/plans";

/** Envoie le client sur la page de consentement eBay (?account=<id> pour reconnecter un compte). */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));

  const accountId = new URL(req.url).searchParams.get("account");
  const reconnect = accountId && user.ebayAccounts.some((a: { id: string }) => a.id === accountId) ? accountId : null;
  if (!reconnect && user.ebayAccounts.length >= maxEbayAccounts(user.plan))
    return NextResponse.redirect(new URL("/settings?ebay=limit", req.url));

  const jar = await cookies();
  const state = crypto.randomBytes(16).toString("hex");
  jar.set("ebay_oauth_state", state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
  if (reconnect) jar.set("ebay_reconnect", reconnect, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
  else jar.delete("ebay_reconnect");
  return NextResponse.redirect(authorizeUrl(state));
}
