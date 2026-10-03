import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { listingErrorResponse } from "@/lib/api-errors";
import { listingFull, MAX_EDIT_PHOTOS, updateListingFull } from "@/lib/listing-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Tout le contenu d'une annonce en ligne (lu chez eBay), pour la modifier sans la retirer. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  try {
    return NextResponse.json(await listingFull(user, (await params).id));
  } catch (e) {
    return listingErrorResponse(e, "Lecture annonce");
  }
}

const body = z.object({
  title: z.string().min(10).max(200),
  descriptionHtml: z.string().min(20).max(500000),
  images: z.array(z.string().url().startsWith("https://").max(1000)).min(1).max(MAX_EDIT_PHOTOS),
  aspects: z.record(z.string().max(60), z.array(z.string().max(200)).max(30)),
  price: z.number().positive().max(100000).optional(),
  quantity: z.number().int().min(1).max(10).optional(),
  variants: z.array(z.object({ id: z.string().min(1).max(64), price: z.number().positive().max(100000), quantity: z.number().int().min(1).max(10) })).max(20).optional(),
});

/** Met à jour toute l'annonce eBay sur place (même annonce, mêmes vues et ventes). */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  try {
    return NextResponse.json(await updateListingFull(user, (await params).id, parsed.data));
  } catch (e) {
    return listingErrorResponse(e, "Mise à jour annonce");
  }
}
