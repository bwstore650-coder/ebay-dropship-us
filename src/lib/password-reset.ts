/** Mot de passe oublié : jetons aléatoires à usage unique, valables 1 heure (on n'enregistre que leur empreinte). */
import { createHash, randomBytes } from "node:crypto";

export const RESET_TTL_MS = 60 * 60_000;
export const MAX_RESETS_PER_HOUR = 3;

export const hashToken = (raw: string) => createHash("sha256").update(raw).digest("hex");

export function newResetToken(now = Date.now()): { raw: string; hash: string; expiresAt: Date } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashToken(raw), expiresAt: new Date(now + RESET_TTL_MS) };
}

/** Jeton utilisable : existe, pas encore utilisé, pas expiré. */
export function isUsable(t: { usedAt: Date | null; expiresAt: Date } | null, now = Date.now()): boolean {
  return !!t && !t.usedAt && t.expiresAt.getTime() > now;
}

/* ---------- Blocage après trop d'essais de mot de passe ---------- */

export const MAX_FAILED_LOGINS = 8;
export const LOCK_MS = 15 * 60_000;

export const isLocked = (u: { lockedUntil: Date | null }, now = Date.now()) => !!u.lockedUntil && u.lockedUntil.getTime() > now;

/** Après un échec : nouveau compteur, et blocage de 15 minutes au 8e échec. */
export function afterFailedLogin(failed: number, now = Date.now()): { failedLogins: number; lockedUntil: Date | null } {
  const n = failed + 1;
  return n >= MAX_FAILED_LOGINS ? { failedLogins: 0, lockedUntil: new Date(now + LOCK_MS) } : { failedLogins: n, lockedUntil: null };
}

/** Session ouverte avant le dernier changement de mot de passe : refusée. */
export function sessionStillValid(issuedAtSec: number | undefined, passwordChangedAt: Date | null): boolean {
  if (!passwordChangedAt) return true;
  if (!issuedAtSec) return false;
  return issuedAtSec * 1000 >= Math.floor(passwordChangedAt.getTime() / 1000) * 1000;
}
