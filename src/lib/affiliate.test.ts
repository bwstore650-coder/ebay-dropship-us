import { describe, expect, it } from "vitest";
import { availableAt, commissionCents, newReferralCode, sanitizeRefCode, totals } from "./affiliate";

describe("affiliation", () => {
  it("30 % arrondi à l'inférieur", () => {
    expect(commissionCents(5900)).toBe(1770);
    expect(commissionCents(2900)).toBe(870);
    expect(commissionCents(24900)).toBe(7470);
    expect(commissionCents(1)).toBe(0);
    expect(commissionCents(0)).toBe(0);
    expect(commissionCents(-100)).toBe(0);
  });
  it("disponible 30 jours après le paiement", () => {
    expect(availableAt(new Date("2026-10-01T00:00:00Z")).toISOString()).toBe("2026-10-31T00:00:00.000Z");
  });
  it("codes valides et nettoyés", () => {
    expect(newReferralCode()).toMatch(/^[a-z0-9]{8}$/);
    expect(sanitizeRefCode(" JamesS ")).toBe("jamess");
    expect(sanitizeRefCode("a<b>")).toBeNull();
    expect(sanitizeRefCode("ab")).toBeNull();
    expect(sanitizeRefCode(null)).toBeNull();
  });
  it("totaux par statut", () => {
    const now = new Date("2026-11-15");
    const t = totals([
      { amountCents: 1000, status: "PENDING", availableAt: new Date("2026-12-01") },
      { amountCents: 2000, status: "PENDING", availableAt: new Date("2026-11-01") },
      { amountCents: 3000, status: "PAYABLE", availableAt: new Date("2026-10-01") },
      { amountCents: 4000, status: "PAID", availableAt: new Date("2026-09-01") },
      { amountCents: 5000, status: "VOID", availableAt: new Date("2026-09-01") },
    ], now);
    expect(t).toEqual({ pendingCents: 1000, payableCents: 5000, paidCents: 4000 });
  });
});
