import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { AiServiceFailure, generate } from "@/lib/ai-service";
import { cachedDemand } from "@/lib/ebay-quota";
import { cleanProductId, ExtensionError } from "@/lib/extension";
import { extRoute, readJson } from "@/lib/extension-route";
import { isMarketplaceId, marketplace, type MarketplaceId } from "@/lib/marketplaces";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Extension : 3 titres eBay écrits par l'IA pour un produit CJ déjà analysé ({ productId, marketId? }). */
export const POST = extRoute(async (user, req) => {
  const b = await readJson(req);
  const productId = cleanProductId(b?.productId);
  if (!productId) throw new ExtensionError("INVALID_INPUT");
  const m = marketplace(typeof b?.marketId === "string" && isMarketplaceId(b.marketId) ? (b.marketId as MarketplaceId) : user.defaultMarketplace);
  const p = await db.productInsight.findUnique({ where: { marketplace_supplier_productId: { marketplace: m.id, supplier: "CJ", productId } } });
  if (!p?.title) throw new ExtensionError("NOT_FOUND"); // analyser le produit d'abord
  const comparableTitles = await cachedDemand(p.keyword, 10, m.id)
    .then((d) => d.items.slice(0, 8).map((i) => i.title))
    .catch(() => []);
  try {
    const r = await generate(user, { kind: "titles", context: { language: m.listingLanguage, productTitle: p.title, comparableTitles } });
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof AiServiceFailure) {
      const status = e.code === "PLAN_REQUIRED" ? 402 : e.code === "AI_LIMIT" ? 429 : 503;
      return NextResponse.json({ error: e.code }, { status });
    }
    throw e;
  }
});
