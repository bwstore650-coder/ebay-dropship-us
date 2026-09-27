import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getI18n } from "@/lib/i18n/server";
import { reviewInput } from "@/lib/reviews";

/** Crée ou modifie l'avis du client connecté. Chaque envoi repasse en attente de validation. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const parsed = reviewInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const { locale } = await getI18n();
  const data = {
    rating: parsed.data.rating,
    text: parsed.data.text,
    authorName: parsed.data.authorName,
    authorInfo: parsed.data.authorInfo || null,
    consent: true,
    locale,
    status: "PENDING" as const,
    approvedAt: null,
  };
  await db.review.upsert({ where: { userId: user.id }, create: { userId: user.id, ...data }, update: data });
  return NextResponse.json({ ok: true });
}
