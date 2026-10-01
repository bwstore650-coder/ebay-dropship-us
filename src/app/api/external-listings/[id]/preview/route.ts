import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { ExternalError, previewLink } from "@/lib/external-listings";
import { externalErrorResponse } from "@/lib/external-route";
import { parseSupplierInput } from "@/lib/suppliers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Aperçu de la liaison : { input: lien ou numéro du produit, supplier?: "CJ" | "ALIEXPRESS", variantId? }. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { id } = await params;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    const parsed = typeof b?.input === "string" ? parseSupplierInput(b.input.slice(0, 500), b?.supplier === "ALIEXPRESS" ? "ALIEXPRESS" : "CJ") : null;
    if (!parsed) throw new ExternalError("INVALID_INPUT");
    const variantId = typeof b?.variantId === "string" ? b.variantId.slice(0, 80) : undefined;
    return NextResponse.json(await previewLink(user, id, { ...parsed, variantId }));
  } catch (e) {
    return externalErrorResponse(e, "Annonces externes (aperçu)");
  }
}
