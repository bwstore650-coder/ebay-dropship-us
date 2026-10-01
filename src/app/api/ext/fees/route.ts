import { NextResponse } from "next/server";
import { ExtensionError, feeCalculator } from "@/lib/extension";
import { extRoute, readJson } from "@/lib/extension-route";

export const dynamic = "force-dynamic";

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN);

/** Calculateur de frais : { price, cost, shipping?, marketId? } → frais eBay, profit, marge, prix minimum. */
export const POST = extRoute(async (user, req) => {
  const b = await readJson(req);
  const price = num(b?.price);
  const cost = num(b?.cost);
  const shipping = b?.shipping === undefined || b?.shipping === "" ? 0 : num(b?.shipping);
  const ok = (n: number) => Number.isFinite(n) && n >= 0 && n < 1_000_000;
  if (!ok(price) || !ok(cost) || !ok(shipping) || price === 0) throw new ExtensionError("INVALID_INPUT");
  const marketId = typeof b?.marketId === "string" ? b.marketId : user.defaultMarketplace;
  return NextResponse.json(feeCalculator({ price, cost, shipping, marketId, minMarginPct: user.minMarginPct }));
});
