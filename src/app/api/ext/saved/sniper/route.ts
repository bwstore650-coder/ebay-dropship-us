import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { extRoute, readJson } from "@/lib/extension-route";
import { isMarketplaceId, marketplace } from "@/lib/marketplaces";
import { createRun, MAX_IDEAS_PER_RUN } from "@/lib/sniper-service";

export const dynamic = "force-dynamic";

/** Envoie la liste d'idées au Sniper (les plus récentes, 50 au maximum) : { marketId? }. */
export const POST = extRoute(async (user, req) => {
  const b = await readJson(req);
  const items = await db.savedProduct.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: MAX_IDEAS_PER_RUN });
  if (!items.length) return NextResponse.json({ error: "SAVED_EMPTY" }, { status: 400 });
  const marketId = typeof b?.marketId === "string" && isMarketplaceId(b.marketId) ? b.marketId : marketplace(user.defaultMarketplace).id;
  const run = await createRun(user, {
    mode: "CATALOG",
    marketId,
    target: items.length,
    seeds: [],
    autoList: false,
    products: items.map((i) => ({ productId: i.productId, title: i.title })),
  });
  return NextResponse.json({ runId: run.id, count: items.length, url: `${env().APP_URL.replace(/\/+$/, "")}/sniper` });
});
