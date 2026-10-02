import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { pushConfigured } from "@/lib/notify";

const sub = z.object({
  endpoint: z.string().url().max(1000).refine((u) => u.startsWith("https://")),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});

/** Abonne cet appareil aux notifications de vente. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!pushConfigured()) return NextResponse.json({ error: "PUSH_UNAVAILABLE" }, { status: 503 });
  const parsed = sub.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const { endpoint, keys } = parsed.data;
  // Au plus 10 appareils par compte : les plus anciens sont retirés.
  const existing = await db.pushSubscription.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, select: { id: true, endpoint: true } });
  const extra = existing.filter((e) => e.endpoint !== endpoint).slice(9);
  if (extra.length) await db.pushSubscription.deleteMany({ where: { id: { in: extra.map((e) => e.id) } } });
  await db.pushSubscription.upsert({ where: { endpoint }, create: { userId: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth }, update: { userId: user.id, p256dh: keys.p256dh, auth: keys.auth } });
  return NextResponse.json({ ok: true });
}

/** Désabonne cet appareil. */
export async function DELETE(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { endpoint?: unknown } | null;
  if (typeof body?.endpoint !== "string") return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  await db.pushSubscription.deleteMany({ where: { userId: user.id, endpoint: body.endpoint } });
  return NextResponse.json({ ok: true });
}
