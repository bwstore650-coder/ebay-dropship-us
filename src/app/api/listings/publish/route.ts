import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { isMarketplaceId, type MarketplaceId } from "@/lib/marketplaces";
import { publishListing } from "@/lib/listing-service";
import { listingErrorResponse } from "@/lib/api-errors";

const body = z.object({
  ebayAccountId: z.string().min(1),
  marketId: z.string().refine(isMarketplaceId),
  ref: z.object({ supplier: z.enum(["CJ", "ALIEXPRESS"]), productId: z.string().min(1).max(64), variantId: z.string().max(64).optional() }),
  categoryId: z.string().regex(/^\d{1,12}$/),
  title: z.string().min(10).max(200),
  descriptionHtml: z.string().min(20).max(20000),
  aspects: z.record(z.string().max(60), z.array(z.string().max(200)).max(30)),
  price: z.number().positive().max(100000),
  quantity: z.number().int().min(1).max(10),
  keyword: z.string().max(120).optional(),
  // Annonce à variantes : variantes choisies (prix et quantité de chacune).
  variants: z.array(z.object({ variantId: z.string().min(1).max(64), price: z.number().positive().max(100000), quantity: z.number().int().min(1).max(10) })).min(2).max(20).optional(),
  mainVariantId: z.string().min(1).max(64).optional(),
  images: z.array(z.string().url().startsWith("https://").max(1000)).min(1).max(12).optional(),
});

/** Publie l'annonce sur eBay (tout est revérifié côté serveur). */
export const maxDuration = 60;

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  try {
    return NextResponse.json(await publishListing(user, { ...parsed.data, marketId: parsed.data.marketId as MarketplaceId }));
  } catch (e) {
    return listingErrorResponse(e, "Publication annonce");
  }
}
