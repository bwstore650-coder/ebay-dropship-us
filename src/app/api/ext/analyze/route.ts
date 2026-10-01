import { NextResponse } from "next/server";
import { analyzeForExtension, cleanProductId, ExtensionError } from "@/lib/extension";
import { extRoute, readJson } from "@/lib/extension-route";
import { isMarketplaceId } from "@/lib/marketplaces";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Analyse d'un produit CJ ouvert dans le navigateur : { productId, marketId? }. */
export const POST = extRoute(async (user, req) => {
  const b = await readJson(req);
  const productId = cleanProductId(b?.productId);
  if (!productId) throw new ExtensionError("INVALID_INPUT");
  const marketId = typeof b?.marketId === "string" && isMarketplaceId(b.marketId) ? b.marketId : null;
  return NextResponse.json(await analyzeForExtension(user, productId, marketId));
});
