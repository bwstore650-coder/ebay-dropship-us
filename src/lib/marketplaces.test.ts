import { describe, expect, it } from "vitest";
import { isMarketplaceId, marketplace, MARKETPLACE_IDS, MARKETPLACES } from "./marketplaces";

describe("marketplaces", () => {
  it("9 pays, identifiants cohérents", () => {
    expect(MARKETPLACE_IDS).toHaveLength(9);
    for (const id of MARKETPLACE_IDS) expect(MARKETPLACES[id].id).toBe(id);
  });
  it("taux plausibles", () => {
    for (const m of Object.values(MARKETPLACES)) {
      expect(m.fvfRate).toBeGreaterThan(0.05);
      expect(m.fvfRate).toBeLessThan(0.2);
      expect(m.perOrderFeeHigh).toBeGreaterThanOrEqual(m.perOrderFeeLow);
      expect(m.source).toMatch(/^https:\/\//);
    }
  });
  it("les pays de l'euro sont en EUR", () => {
    for (const id of ["EBAY_DE", "EBAY_FR", "EBAY_IT", "EBAY_ES", "EBAY_IE"] as const) expect(MARKETPLACES[id].currency).toBe("EUR");
  });
  it("identifiant inconnu → États-Unis", () => {
    expect(isMarketplaceId("EBAY_XX")).toBe(false);
    expect(marketplace("EBAY_XX").id).toBe("EBAY_US");
    expect(marketplace(undefined).id).toBe("EBAY_US");
  });
});
