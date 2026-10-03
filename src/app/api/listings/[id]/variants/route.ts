import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { listingErrorResponse } from "@/lib/api-errors";
import { updateVariants, variantEditor } from "@/lib/listing-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Variantes d'une annonce en ligne (pour les modifier sans la retirer). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  try {
    return NextResponse.json(await variantEditor(user, (await params).id));
  } catch (e) {
    return listingErrorResponse(e, "Variantes annonce");
  }
}

const body = z.object({
  mainVariantId: z.string().min(1).max(64).optional(),
  variants: z.array(z.object({ id: z.string().min(1).max(64), price: z.number().positive().max(100000), quantity: z.number().int().min(1).max(10) })).max(20),
});

/** Variante principale, photos qui suivent la variante, prix et quantités : l'annonce eBay est mise à jour. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  try {
    return NextResponse.json(await updateVariants(user, (await params).id, parsed.data));
  } catch (e) {
    return listingErrorResponse(e, "Mise à jour variantes");
  }
}
