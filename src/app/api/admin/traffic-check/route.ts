import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { isAdminEmail, parseAdminEmails } from "@/lib/admin";
import * as ebay from "@/lib/ebay";
import { userToken } from "@/lib/ebay-account";

/** TEMPORAIRE (diagnostic) : erreur exacte d'eBay pour le rapport de trafic. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user || !isAdminEmail(user.email, parseAdminEmails(process.env.ADMIN_EMAILS))) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const a = user.ebayAccounts[0];
  const days = Number(new URL(req.url).searchParams.get("days") ?? 7);
  const endOffset = Number(new URL(req.url).searchParams.get("end") ?? 0);
  const now = Date.now();
  try {
    const rows = await ebay.getTrafficReport(await userToken(a), { marketId: "EBAY_US", from: new Date(now - (2 * days - 1 + endOffset) * 86400000), to: new Date(now - endOffset * 86400000), dimension: "DAY" });
    return NextResponse.json({ ok: true, scopes: (a as { scopes?: string }).scopes, n: rows.length, rows: rows.slice(-3) });
  } catch (e) {
    return NextResponse.json({ ok: false, scopes: (a as { scopes?: string }).scopes, error: String(e).slice(0, 1500) });
  }
}
