import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { isMarketplaceId, type MarketplaceId } from "@/lib/marketplaces";
import { prepareListing } from "@/lib/listing-service";
import { listingErrorResponse } from "@/lib/api-errors";

const body = z.object({
  keyword: z.string().min(2).max(120),
  marketId: z.string().refine(isMarketplaceId),
  ref: z.object({ supplier: z.enum(["CJ", "ALIEXPRESS"]), productId: z.string().min(1).max(64), variantId: z.string().max(64).optional() }),
});

/** Brouillon d'annonce (titre et description rédigés par l'IA, catégorie, caractéristiques, prix conseillé). */
export const maxDuration = 60;

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  try {
    return NextResponse.json(await prepareListing(user, { ...parsed.data, marketId: parsed.data.marketId as MarketplaceId }));
  } catch (e) {
    return listingErrorResponse(e, "Préparation annonce");
  }
}
