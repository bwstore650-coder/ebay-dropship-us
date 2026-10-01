import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { isQuotaError } from "@/lib/ebay";
import { isMarketplaceId, marketplace, type MarketplaceId } from "@/lib/marketplaces";
import { analyzeTitles } from "@/lib/research-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Title Builder : ?keyword=…&market=EBAY_US */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (user.plan === "NONE") return NextResponse.json({ error: "PLAN_REQUIRED" }, { status: 402 });
  const q = new URL(req.url).searchParams;
  const keyword = (q.get("keyword") ?? "").trim().slice(0, 120);
  const market = q.get("market") ?? user.defaultMarketplace;
  if (keyword.length < 2 || !isMarketplaceId(market)) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  try {
    return NextResponse.json(await analyzeTitles(keyword, marketplace(market as MarketplaceId).id));
  } catch (e) {
    console.error("Title Builder", keyword, e);
    if (isQuotaError(e)) return NextResponse.json({ error: "EBAY_QUOTA" }, { status: 503 });
    return NextResponse.json({ error: "UPSTREAM" }, { status: 502 });
  }
}
