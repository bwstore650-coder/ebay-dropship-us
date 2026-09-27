import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword, startSession } from "@/lib/auth";
import { newReferralCode, REF_COOKIE, sanitizeRefCode } from "@/lib/affiliate";
import { getI18n } from "@/lib/i18n/server";
import { sendEmail, welcomeEmail } from "@/lib/email";

const body = z.object({ email: z.string().email().max(200), password: z.string().min(8).max(200), acceptTerms: z.literal(true) });

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = body.safeParse(json);
  if (!parsed.success) {
    const termsMissing = json && typeof json === "object" && (json as { acceptTerms?: unknown }).acceptTerms !== true;
    return NextResponse.json({ error: termsMissing ? "TERMS_REQUIRED" : "INVALID_INPUT" }, { status: 400 });
  }
  const { locale } = await getI18n();
  const email = parsed.data.email.toLowerCase();
  if (await db.user.findUnique({ where: { email } }))
    return NextResponse.json({ error: "EMAIL_TAKEN" }, { status: 409 });

  // Parrain : code du cookie « ref », s'il correspond à un utilisateur existant.
  const refCode = sanitizeRefCode((await cookies()).get(REF_COOKIE)?.value);
  const referrer = refCode ? await db.user.findUnique({ where: { referralCode: refCode }, select: { id: true } }) : null;

  const user = await db.user.create({
    data: {
      email,
      passwordHash: await hashPassword(parsed.data.password),
      referralCode: newReferralCode(),
      referredById: referrer?.id ?? null,
      locale,
      termsAcceptedAt: new Date(),
    },
  });
  await startSession(user.id);
  await sendEmail(welcomeEmail(user.email, locale), `welcome-${user.id}`);
  return NextResponse.json({ ok: true });
}
