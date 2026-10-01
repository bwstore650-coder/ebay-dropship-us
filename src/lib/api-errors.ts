import { NextResponse } from "next/server";
import { ListingError } from "@/lib/listing-service";
import { EbayApiError, isQuotaError, TradingError } from "@/lib/ebay";
import { EbayReconnectRequired } from "@/lib/ebay-account";

/** Réponse JSON d'erreur commune aux routes d'annonces : { error: CODE, detail? }. */
export function listingErrorResponse(e: unknown, context: string) {
  if (e instanceof ListingError) {
    const status = e.code === "PLAN_REQUIRED" ? 402 : e.code === "EBAY_REJECTED" ? 502 : 400;
    return NextResponse.json({ error: e.code, detail: e.detail }, { status });
  }
  if (e instanceof EbayReconnectRequired || (e instanceof EbayApiError && e.status === 401))
    return NextResponse.json({ error: "EBAY_RECONNECT" }, { status: 400 });
  if (isQuotaError(e)) return NextResponse.json({ error: "EBAY_QUOTA" }, { status: 503 });
  if (e instanceof EbayApiError) {
    console.error(context, e);
    return NextResponse.json({ error: "EBAY_REJECTED", detail: e.readable }, { status: 502 });
  }
  if (e instanceof TradingError) {
    console.error(context, e);
    return NextResponse.json({ error: "EBAY_REJECTED", detail: e.detail }, { status: 502 });
  }
  console.error(context, e);
  return NextResponse.json({ error: "UPSTREAM" }, { status: 502 });
}
