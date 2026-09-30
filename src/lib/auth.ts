import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { readSession, SESSION_COOKIE, signSession } from "@/lib/session";
import { sessionStillValid } from "@/lib/password-reset";
import { ADMIN_PLAN, COMP_INTERVAL, isAdminEmail, parseAdminEmails } from "@/lib/admin";

export const hashPassword = (p: string) => bcrypt.hash(p, 12);
export const checkPassword = (p: string, h: string) => bcrypt.compare(p, h);

export async function startSession(userId: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await signSession(userId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Utilisateur connecté, ou null. */
export async function currentUser() {
  const session = await readSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const user = await db.user.findUnique({ where: { id: session.userId }, include: { ebayAccounts: { orderBy: { createdAt: "asc" } }, supplierAccounts: true } });
  // Mot de passe changé depuis l'ouverture de cette session : elle n'est plus valable.
  if (!user || !sessionStillValid(session.issuedAt, user.passwordChangedAt)) return null;
  // Les administrateurs ont l'accès complet offert (enregistré en base pour que les tâches automatiques en tiennent compte aussi).
  if (user.plan === "NONE" && isAdminEmail(user.email, parseAdminEmails(process.env.ADMIN_EMAILS))) {
    await db.user.update({ where: { id: user.id }, data: { plan: ADMIN_PLAN, billingInterval: COMP_INTERVAL } });
    return { ...user, plan: ADMIN_PLAN, billingInterval: COMP_INTERVAL };
  }
  return user;
}

/** Utilisateur connecté, sinon redirection vers /login (pour les pages protégées). */
export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

/** Administrateur (email présent dans ADMIN_EMAILS), sinon page 404 : l'espace admin reste invisible. */
export async function requireAdmin() {
  const user = await requireUser();
  if (!isAdminEmail(user.email, parseAdminEmails(process.env.ADMIN_EMAILS))) notFound();
  return user;
}
