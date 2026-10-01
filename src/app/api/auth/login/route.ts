import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { checkPassword, startSession } from "@/lib/auth";
import { afterFailedLogin, isLocked } from "@/lib/password-reset";

/** Empreinte factice : même temps de réponse que l'email existe ou non (ne révèle pas les comptes). */
const DUMMY_HASH = "$2b$12$xuBTmIBY6E/YZ5qXZBraW.z90Lr8PoOAsOKnzD.A7npDz5oIJbgfO";

const body = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const user = await db.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (!user) {
    await checkPassword(parsed.data.password, DUMMY_HASH);
    return NextResponse.json({ error: "BAD_CREDENTIALS" }, { status: 401 });
  }
  // Trop d'essais : compte bloqué 15 minutes (contre les attaques par force brute).
  if (isLocked(user)) return NextResponse.json({ error: "TOO_MANY_ATTEMPTS" }, { status: 429 });
  // Compte créé avec Google, sans mot de passe : il faut utiliser le bouton Google (ou « mot de passe oublié » pour en créer un).
  if (!user.passwordHash) {
    await checkPassword(parsed.data.password, DUMMY_HASH);
    return NextResponse.json({ error: "USE_GOOGLE" }, { status: 401 });
  }
  if (!(await checkPassword(parsed.data.password, user.passwordHash))) {
    const next = afterFailedLogin(user.failedLogins);
    await db.user.update({ where: { id: user.id }, data: next });
    return NextResponse.json({ error: next.lockedUntil ? "TOO_MANY_ATTEMPTS" : "BAD_CREDENTIALS" }, { status: next.lockedUntil ? 429 : 401 });
  }
  if (user.failedLogins || user.lockedUntil) await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
  await startSession(user.id);
  return NextResponse.json({ ok: true });
}
