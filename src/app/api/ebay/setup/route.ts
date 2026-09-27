import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { isMarketplaceId, type MarketplaceId } from "@/lib/marketplaces";
import { saveSetup, setupOptions } from "@/lib/listing-service";
import { listingErrorResponse } from "@/lib/api-errors";

const query = z.object({ accountId: z.string().min(1), marketId: z.string().refine(isMarketplaceId) });

/** Politiques eBay du vendeur pour un pays + réglage déjà enregistré. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const url = new URL(req.url);
  const parsed = query.safeParse({ accountId: url.searchParams.get("accountId"), marketId: url.searchParams.get("marketId") });
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  try {
    return NextResponse.json(await setupOptions(user, parsed.data.accountId, parsed.data.marketId as MarketplaceId));
  } catch (e) {
    return listingErrorResponse(e, "Réglages eBay");
  }
}

const body = query.extend({
  fulfillmentPolicyId: z.string().min(1).max(40),
  paymentPolicyId: z.string().min(1).max(40),
  returnPolicyId: z.string().min(1).max(40),
  postalCode: z.string().trim().min(2).max(12),
  city: z.string().trim().max(60).optional(),
  stateOrProvince: z.string().trim().max(60).optional(),
});

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  try {
    await saveSetup(user, { ...parsed.data, marketId: parsed.data.marketId as MarketplaceId });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return listingErrorResponse(e, "Réglages eBay");
  }
}
