import { describe, expect, it } from "vitest";
import { afterFailedLogin, hashToken, isLocked, isUsable, LOCK_MS, newResetToken, sessionStillValid } from "./password-reset";

describe("mot de passe oublié", () => {
  it("jeton aléatoire, seule l'empreinte est gardée, valable 1 h", () => {
    const a = newResetToken(0);
    const b = newResetToken(0);
    expect(a.raw).not.toBe(b.raw);
    expect(a.raw.length).toBeGreaterThanOrEqual(43);
    expect(a.hash).toBe(hashToken(a.raw));
    expect(a.hash).not.toContain(a.raw);
    expect(a.expiresAt.getTime()).toBe(3600_000);
  });
  it("utilisable une seule fois et avant expiration", () => {
    const t = { usedAt: null, expiresAt: new Date(1000) };
    expect(isUsable(t, 999)).toBe(true);
    expect(isUsable(t, 1000)).toBe(false);
    expect(isUsable({ ...t, usedAt: new Date(0) }, 0)).toBe(false);
    expect(isUsable(null)).toBe(false);
  });
});

describe("protection de la connexion", () => {
  it("blocage 15 min au 8e échec", () => {
    let s = { failedLogins: 0, lockedUntil: null as Date | null };
    for (let i = 0; i < 7; i++) s = afterFailedLogin(s.failedLogins, 0);
    expect(s).toEqual({ failedLogins: 7, lockedUntil: null });
    s = afterFailedLogin(s.failedLogins, 0);
    expect(s.lockedUntil?.getTime()).toBe(LOCK_MS);
    expect(isLocked(s, LOCK_MS - 1)).toBe(true);
    expect(isLocked(s, LOCK_MS)).toBe(false);
  });
  it("sessions ouvertes avant le changement de mot de passe refusées", () => {
    const changed = new Date(1_700_000_000_500);
    expect(sessionStillValid(1_700_000_000, changed)).toBe(true); // même seconde
    expect(sessionStillValid(1_699_999_999, changed)).toBe(false);
    expect(sessionStillValid(undefined, null)).toBe(true);
  });
});
