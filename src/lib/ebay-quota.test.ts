import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { resumeAt, scannerMayRun } from "./ebay-quota";
import { scanBudget } from "./product-pool";

vi.mock("@/lib/crypto", () => ({ decrypt: (s: string) => s }));

describe("quota eBay", () => {
  const now = Date.parse("2026-09-30T20:00:00Z");
  it("reprise : remise à zéro d'eBay + 1 min, 30 min si inconnue, 24 h au plus", () => {
    expect(resumeAt("2026-09-30T23:00:00Z", now).toISOString()).toBe("2026-09-30T23:01:00.000Z");
    expect(resumeAt(null, now).getTime()).toBe(now + 30 * 60_000);
    expect(resumeAt("2026-09-30T19:00:00Z", now).getTime()).toBe(now + 30 * 60_000); // déjà passée
    expect(resumeAt("2026-10-05T00:00:00Z", now).getTime()).toBe(now + 24 * 3600_000 + 60_000);
  });
  it("le scanner garde la moitié du quota pour les vendeurs", () => {
    expect(scannerMayRun(null)).toBe(true);
    expect(scannerMayRun({ limit: 5000, remaining: 4000, reset: null })).toBe(true);
    expect(scannerMayRun({ limit: 5000, remaining: 2500, reset: null })).toBe(false);
    expect(scanBudget({ limit: 5000, remaining: 3600 })).toBe(91); // (3600 - 2500) / 12
    expect(scanBudget({ limit: 5000, remaining: 1000 })).toBe(0);
    expect(scanBudget(null)).toBe(Infinity);
  });
});
