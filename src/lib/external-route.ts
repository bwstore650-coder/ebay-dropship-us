import { NextResponse } from "next/server";
import { ExternalError } from "@/lib/external-listings";
import { listingErrorResponse } from "@/lib/api-errors";

/** Réponse JSON d'erreur des routes /api/external-listings. */
export function externalErrorResponse(e: unknown, context: string) {
  if (e instanceof ExternalError) {
    const status = e.code === "NOT_FOUND" ? 404 : e.code === "RATE_LIMITED" ? 429 : 400;
    return NextResponse.json({ error: e.code }, { status });
  }
  return listingErrorResponse(e, context);
}
