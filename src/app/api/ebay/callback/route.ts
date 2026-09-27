import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { exchangeCode } from "@/lib/ebay";

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

  const t = await exchangeCode(code);
  const now = Date.now();
  const data = {
    accessToken: encrypt(t.access_token),
    accessTokenExpires: new Date(now + t.expires_in * 1000),
    refreshToken: encrypt(t.refresh_token ?? ""),
    refreshTokenExpires: new Date(now + (t.refresh_token_expires_in ?? 0) * 1000),
  };
  await db.ebayAccount.upsert({ where: { userId: user.id }, create: { userId: user.id, ...data }, update: data });
  return NextResponse.redirect(new URL("/settings?ebay=connected", req.url));
}
