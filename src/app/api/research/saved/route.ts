import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isMarketplaceId } from "@/lib/marketplaces";
import { normalizeSeller } from "@/lib/research";

const body = z.object({ username: z.string().max(200), market: z.string().refine(isMarketplaceId) });
const MAX_SAVED = 50;

/** Ajoute un vendeur aux vendeurs suivis. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  const username = parsed.success ? normalizeSeller(parsed.data.username) : null;
  if (!parsed.success || !username) return NextResponse.json({ error: "SELLER_INVALID" }, { status: 400 });
  if ((await db.savedSeller.count({ where: { userId: user.id } })) >= MAX_SAVED) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  await db.savedSeller.upsert({
    where: { userId_username_marketplace: { userId: user.id, username, marketplace: parsed.data.market } },
    create: { userId: user.id, username, marketplace: parsed.data.market },
    update: {},
  });
  return NextResponse.json({ ok: true });
}

/** Retire un vendeur suivi. */
export async function DELETE(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  const username = parsed.success ? normalizeSeller(parsed.data.username) : null;
  if (!parsed.success || !username) return NextResponse.json({ error: "SELLER_INVALID" }, { status: 400 });
  await db.savedSeller.deleteMany({ where: { userId: user.id, username, marketplace: parsed.data.market } });
  return NextResponse.json({ ok: true });
}
