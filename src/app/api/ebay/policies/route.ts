import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { isMarketplaceId, type MarketplaceId } from "@/lib/marketplaces";
import { createStandardPolicies } from "@/lib/listing-service";
import { listingErrorResponse } from "@/lib/api-errors";

const body = z.object({ accountId: z.string().min(1), marketId: z.string().refine(isMarketplaceId) });

/** Crée les politiques eBay standard qui manquent (livraison gratuite, paiement immédiat, retours 30 jours). */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  try {
    return NextResponse.json(await createStandardPolicies(user, parsed.data.accountId, parsed.data.marketId as MarketplaceId));
  } catch (e) {
    return listingErrorResponse(e, "Politiques eBay standard");
  }
}
