import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { ExternalError, linkExternal, unlinkExternal } from "@/lib/external-listings";
import { externalErrorResponse } from "@/lib/external-route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ID = /^[A-Za-z0-9_-]{1,80}$/;

/** Lie l'annonce à une variante fournisseur : { supplier, productId, variantId }. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (user.plan === "NONE") return NextResponse.json({ error: "PLAN_REQUIRED" }, { status: 402 });
  const { id } = await params;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    const supplier = b?.supplier === "ALIEXPRESS" ? "ALIEXPRESS" : b?.supplier === "CJ" ? "CJ" : null;
    const productId = typeof b?.productId === "string" && ID.test(b.productId) ? b.productId : null;
    const variantId = typeof b?.variantId === "string" && ID.test(b.variantId) ? b.variantId : null;
    if (!supplier || !productId || !variantId) throw new ExternalError("INVALID_INPUT");
    const listing = await linkExternal(user, id, { supplier, productId, variantId });
    return NextResponse.json({ listingId: listing.id });
  } catch (e) {
    return externalErrorResponse(e, "Annonces externes (liaison)");
  }
}

/** Arrête la gestion de l'annonce par Sellvela (elle reste sur eBay). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { id } = await params;
  try {
    await unlinkExternal(user, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return externalErrorResponse(e, "Annonces externes (fin de gestion)");
  }
}
