import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { listingErrorResponse } from "@/lib/api-errors";
import { listingContent, updateListingContent } from "@/lib/listing-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Titre et description actuels d'une annonce publiée (fenêtre « Améliorer avec l'IA »). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  try {
    return NextResponse.json(await listingContent(user, (await params).id));
  } catch (e) {
    return listingErrorResponse(e, "Contenu annonce");
  }
}

const body = z.object({ title: z.string().max(200), descriptionHtml: z.string().max(20_000) });

/** Envoie le nouveau titre et la nouvelle description à eBay. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  try {
    return NextResponse.json(await updateListingContent(user, (await params).id, parsed.data));
  } catch (e) {
    return listingErrorResponse(e, "Mise à jour annonce");
  }
}
