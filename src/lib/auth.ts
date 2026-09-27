import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { SESSION_COOKIE, signSession, verifySession } from "@/lib/session";

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
  const id = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!id) return null;
  return db.user.findUnique({ where: { id }, include: { ebayAccounts: { orderBy: { createdAt: "asc" } }, supplierAccounts: true } });
}

/** Utilisateur connecté, sinon redirection vers /login (pour les pages protégées). */
export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}
