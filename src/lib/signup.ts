/**
 * Création de compte (email + mot de passe, ou Google) et connexion avec Google.
 * Partagé par /api/auth/register et /api/auth/google/callback.
 */
import { db } from "@/lib/db";
import { newReferralCode, sanitizeRefCode } from "@/lib/affiliate";
import { sendEmail, welcomeEmail } from "@/lib/email";
import type { GoogleProfile } from "@/lib/google-auth";
import type { Locale } from "@/lib/i18n";

export interface SignupContext {
  locale: Locale;
  refCookie?: string | null; // code de parrainage du cookie « ref »
}

/** Nouveau compte (conditions acceptées à l'inscription) + email de bienvenue. */
export async function createAccount(
  data: { email: string; passwordHash?: string | null; googleId?: string | null },
  ctx: SignupContext,
) {
  const refCode = sanitizeRefCode(ctx.refCookie);
  const referrer = refCode ? await db.user.findUnique({ where: { referralCode: refCode }, select: { id: true } }) : null;
  const user = await db.user.create({
    data: {
      email: data.email.toLowerCase(),
      passwordHash: data.passwordHash ?? null,
      googleId: data.googleId ?? null,
      referralCode: newReferralCode(),
      referredById: referrer?.id ?? null,
      locale: ctx.locale,
      termsAcceptedAt: new Date(),
    },
  });
  await sendEmail(welcomeEmail(user.email, ctx.locale), `welcome-${user.id}`);
  return user;
}

export type GoogleSignIn =
  | { ok: true; userId: string; created: boolean }
  | { ok: false; error: "GOOGLE_UNVERIFIED" | "GOOGLE_CONFLICT" };

/**
 * Connexion avec Google :
 * 1. compte déjà lié à ce compte Google → connexion ;
 * 2. compte existant avec le même email (vérifié par Google) → liaison puis connexion ;
 * 3. sinon → nouveau compte.
 */
export async function signInWithGoogle(p: GoogleProfile, ctx: SignupContext): Promise<GoogleSignIn> {
  // Sans email vérifié par Google, impossible de savoir à qui appartient l'adresse.
  if (!p.emailVerified) return { ok: false, error: "GOOGLE_UNVERIFIED" };
  const linked = await db.user.findUnique({ where: { googleId: p.sub }, select: { id: true } });
  if (linked) return { ok: true, userId: linked.id, created: false };
  const existing = await db.user.findUnique({ where: { email: p.email }, select: { id: true, googleId: true } });
  if (existing) {
    // Déjà lié à un AUTRE compte Google : on ne remplace pas la liaison.
    if (existing.googleId && existing.googleId !== p.sub) return { ok: false, error: "GOOGLE_CONFLICT" };
    // L'email d'une inscription par mot de passe n'est pas vérifié : quelqu'un a pu créer le compte avec l'adresse
    // d'un autre. Google prouve qui possède l'adresse : on retire l'ancien mot de passe et on ferme les autres sessions.
    // (Le propriétaire peut en choisir un nouveau avec « mot de passe oublié ».)
    await db.user.update({
      where: { id: existing.id },
      data: { googleId: p.sub, passwordHash: null, passwordChangedAt: new Date(), failedLogins: 0, lockedUntil: null },
    });
    return { ok: true, userId: existing.id, created: false };
  }
  const user = await createAccount({ email: p.email, googleId: p.sub }, ctx);
  return { ok: true, userId: user.id, created: true };
}
