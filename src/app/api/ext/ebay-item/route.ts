import { NextResponse } from "next/server";
import { cleanItemId, ebayItemInsight, ExtensionError } from "@/lib/extension";
import { extRoute, readJson } from "@/lib/extension-route";
import { EBAY_DOMAINS } from "@/lib/listing";
import { MARKETPLACE_IDS } from "@/lib/marketplaces";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Fiche produit eBay ouverte dans le navigateur : { itemId, host } (host = www.ebay.fr…). TEMPORAIRE (tests). */
export const POST = extRoute(async (user, req) => {
  const b = await readJson(req);
  const itemId = cleanItemId(b?.itemId);
  const host = typeof b?.host === "string" ? b.host.toLowerCase().replace(/^(?!www\.)/, "www.") : "";
  const marketId = MARKETPLACE_IDS.find((id) => EBAY_DOMAINS[id] === host);
  if (!itemId || !marketId) throw new ExtensionError("INVALID_INPUT");
  return NextResponse.json(await ebayItemInsight(user, itemId, marketId));
});
