import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { SavedError, sendSavedToSniper } from "@/lib/saved-products";
import { SnipeError } from "@/lib/sniper-service";

export const dynamic = "force-dynamic";

/** Réanalyse les produits sauvegardés avec le Sniper (prix eBay et fournisseur à jour) : { marketId? }. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    return NextResponse.json(await sendSavedToSniper(user, b?.marketId));
  } catch (e) {
    if (e instanceof SavedError || e instanceof SnipeError) return NextResponse.json({ error: e.code }, { status: e.code === "PLAN_REQUIRED" ? 402 : 400 });
    console.error("Sniper (sauvegardés)", e);
    return NextResponse.json({ error: "UPSTREAM" }, { status: 502 });
  }
}
