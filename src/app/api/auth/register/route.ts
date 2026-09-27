import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword, startSession } from "@/lib/auth";
import { newReferralCode, REF_COOKIE, sanitizeRefCode } from "@/lib/affiliate";

const body = z.object({ email: z.string().email(), password: z.string().min(8) });

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Email ou mot de passe invalide (8 caractères min.)" }, { status: 400 });
  const email = parsed.data.email.toLowerCase();
  if (await db.user.findUnique({ where: { email } }))
    return NextResponse.json({ error: "Un compte existe déjà avec cet email" }, { status: 409 });

  // Parrain : code du cookie « ref », s'il correspond à un utilisateur existant.
  const refCode = sanitizeRefCode((await cookies()).get(REF_COOKIE)?.value);
  const referrer = refCode ? await db.user.findUnique({ where: { referralCode: refCode }, select: { id: true } }) : null;

  const user = await db.user.create({
    data: {
      email,
      passwordHash: await hashPassword(parsed.data.password),
      referralCode: newReferralCode(),
      referredById: referrer?.id ?? null,
    },
  });
  await startSession(user.id);
  return NextResponse.json({ ok: true });
}
