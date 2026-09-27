import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { resetEmail, sendEmail } from "@/lib/email";
import { MAX_RESETS_PER_HOUR, newResetToken } from "@/lib/password-reset";

const body = z.object({ email: z.string().email().max(200) });

/** Mot de passe oublié : toujours la même réponse, que le compte existe ou non (ne révèle pas les emails inscrits). */
export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_EMAIL" }, { status: 400 });
  const user = await db.user.findUnique({ where: { email: parsed.data.email.toLowerCase() }, select: { id: true, email: true, locale: true } });
  if (user) {
    const recent = await db.passwordResetToken.count({ where: { userId: user.id, createdAt: { gte: new Date(Date.now() - 3600_000) } } });
    if (recent < MAX_RESETS_PER_HOUR) {
      const t = newResetToken();
      await db.passwordResetToken.create({ data: { userId: user.id, tokenHash: t.hash, expiresAt: t.expiresAt } });
      await sendEmail(resetEmail(user.email, user.locale, t.raw));
    }
  }
  return NextResponse.json({ ok: true });
}
