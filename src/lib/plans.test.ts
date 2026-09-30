import { describe, expect, it } from "vitest";
import { maxEbayAccounts, PLANS } from "./plans";
import { planForPrice, priceIdFor, type PriceTable } from "./stripe";

const table: PriceTable = {
  STARTER: { month: "p_s_m", year: "p_s_y" },
  PRO: { month: "p_p_m", year: "p_p_y" },
  BUSINESS: { month: "p_b_m", year: "p_b_y" },
  AGENCY: { month: "p_a_m", year: "p_a_y" },
};

describe("formules", () => {
  it("prix annuels à −20 %", () => {
    expect(PLANS.map((p) => p.yearlyUsd)).toEqual([374, 758, 1430, 2870]);
  });
  it("comptes eBay par formule", () => {
    expect(maxEbayAccounts("NONE")).toBe(1);
    expect(maxEbayAccounts("PRO")).toBe(2);
    expect(maxEbayAccounts("BUSINESS")).toBe(5);
    expect(maxEbayAccounts("AGENCY")).toBe(15);
  });
  it("retrouve la formule depuis un prix mensuel ou annuel", () => {
    expect(planForPrice("p_a_y", table)).toBe("AGENCY");
    expect(planForPrice("p_s_m", table)).toBe("STARTER");
    expect(planForPrice("inconnu", table)).toBe("NONE");
    expect(planForPrice(undefined, table)).toBe("NONE");
  });
  it("donne le bon prix et refuse un prix manquant", () => {
    expect(priceIdFor("PRO", "year", table)).toBe("p_p_y");
    expect(() => priceIdFor("PRO", "year", { ...table, PRO: { month: "x", year: "" } })).toThrow();
  });
});
