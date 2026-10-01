import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { AUTO_SYNC_MS, ExternalError, MANUAL_SYNC_MS, syncIfDue } from "@/lib/external-listings";
import { externalErrorResponse } from "@/lib/external-route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Relit les annonces eBay créées hors de Sellvela. { auto: true } : seulement si la dernière lecture a plus de 6 h. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const b = (await req.json().catch(() => null)) as { auto?: boolean } | null;
  const auto = b?.auto === true;
  try {
    const report = await syncIfDue(user, auto ? AUTO_SYNC_MS : MANUAL_SYNC_MS);
    if (!report) {
      if (auto) return NextResponse.json({ skipped: true });
      throw new ExternalError("RATE_LIMITED");
    }
    if (report.accounts === 0 && report.errors > 0) return NextResponse.json({ error: "EBAY_SYNC_FAILED" }, { status: 502 });
    return NextResponse.json(report);
  } catch (e) {
    if (auto && e instanceof ExternalError && e.code === "EBAY_NOT_CONNECTED") return NextResponse.json({ skipped: true });
    return externalErrorResponse(e, "Annonces externes (lecture)");
  }
}
