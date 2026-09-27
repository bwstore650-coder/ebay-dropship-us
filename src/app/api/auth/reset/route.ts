import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword, startSession } from "@/lib/auth";
import { hashToken, isUsable } from "@/lib/password-reset";

const body = z.object({ token: z.string().min(20).max(200), password: z.string().min(8).max(200) });

/** Nouveau mot de passe avec un lien valide : les autres liens et les anciennes sessions sont annulés. */
export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const token = await db.passwordResetToken.findUnique({ where: { tokenHash: hashToken(parsed.data.token) } });
  if (!token || !isUsable(token)) return NextResponse.json({ error: "RESET_INVALID" }, { status: 400 });
  // Utilisation unique, même si deux requêtes arrivent en même temps.
  const used = await db.passwordResetToken.updateMany({ where: { id: token.id, usedAt: null }, data: { usedAt: new Date() } });
  if (used.count !== 1) return NextResponse.json({ error: "RESET_INVALID" }, { status: 400 });
  const now = new Date();
  await db.user.update({
    where: { id: token.userId },
    data: { passwordHash: await hashPassword(parsed.data.password), passwordChangedAt: now, failedLogins: 0, lockedUntil: null },
  });
  await db.passwordResetToken.deleteMany({ where: { userId: token.userId, usedAt: null } });
  await startSession(token.userId);
  return NextResponse.json({ ok: true });
}
