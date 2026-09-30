import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { isMarketplaceId, marketplace, type MarketplaceId } from "@/lib/marketplaces";
import { normalizeSeller } from "@/lib/research";
import { analyzeSeller } from "@/lib/research-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Espion de concurrents : ?username=…&market=EBAY_US&keyword=… (mot-clé facultatif pour cibler une niche). */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (user.plan === "NONE") return NextResponse.json({ error: "PLAN_REQUIRED" }, { status: 402 });
  const q = new URL(req.url).searchParams;
  const username = normalizeSeller(q.get("username") ?? "");
  const market = q.get("market") ?? user.defaultMarketplace;
  const keyword = (q.get("keyword") ?? "").slice(0, 120);
  if (!username || !isMarketplaceId(market)) return NextResponse.json({ error: "SELLER_INVALID" }, { status: 400 });
  try {
    return NextResponse.json(await analyzeSeller(username, marketplace(market as MarketplaceId).id, keyword));
  } catch (e) {
    console.error("Concurrent", username, e);
    return NextResponse.json({ error: "UPSTREAM" }, { status: 502 });
  }
}
