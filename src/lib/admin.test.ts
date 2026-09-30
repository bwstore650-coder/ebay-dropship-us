import { describe, expect, it } from "vitest";
import { dailyCounts, isAdminEmail, mrrCents, parseAdminEmails } from "./admin";

const now = new Date("2026-09-27T12:00:00Z");

describe("admin", () => {
  it("emails admin", () => {
    const list = parseAdminEmails(" James@X.com , b@y.com,");
    expect(list).toEqual(["james@x.com", "b@y.com"]);
    expect(isAdminEmail("JAMES@x.com", list)).toBe(true);
    expect(isAdminEmail("autre@x.com", list)).toBe(false);
    expect(isAdminEmail(null, list)).toBe(false);
    expect(isAdminEmail("a@b.c", parseAdminEmails(""))).toBe(false);
  });
  it("MRR : mensuel, annuel / 12, essais et sans formule exclus", () => {
    const mrr = mrrCents([
      { plan: "PRO", billingInterval: "month", trialEndsAt: null },                       // 79 $
      { plan: "AGENCY", billingInterval: "year", trialEndsAt: null },                     // 2870 / 12 = 239,17 $
      { plan: "STARTER", billingInterval: "month", trialEndsAt: new Date("2026-10-01") }, // essai : exclu
      { plan: "NONE", billingInterval: null, trialEndsAt: null },                         // exclu
      { plan: "AGENCY", billingInterval: "comp", trialEndsAt: null },                     // accès admin offert : exclu
      { plan: "BUSINESS", billingInterval: "month", trialEndsAt: new Date("2026-09-01") },// essai fini : 149 $
    ], now);
    expect(mrr).toBe(7900 + 23917 + 14900);
  });
  it("inscriptions par jour", () => {
    const c = dailyCounts([new Date("2026-09-27T01:00:00Z"), new Date("2026-09-27T20:00:00Z"), new Date("2026-09-25T10:00:00Z"), new Date("2026-08-01")], 3, now);
    expect(c).toEqual([{ day: "2026-09-25", count: 1 }, { day: "2026-09-26", count: 0 }, { day: "2026-09-27", count: 2 }]);
  });
});
