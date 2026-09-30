import { describe, expect, it } from "vitest";
import { computeMargin } from "./margin";
import { MARKETPLACES } from "./marketplaces";
import { adRateChanged, affordableAdRate, competitorPrices, isComparable, repriceTarget } from "./pricing";

describe("publicité automatique", () => {
  it("taux le plus haut qui garde la marge, plafonné par le vendeur", () => {
    const r = affordableAdRate({ price: 30, cost: 11.45, minMarginPct: 30, marketId: "EBAY_US", cap: 8 })!;
    expect(r).toBeGreaterThanOrEqual(2);
    expect(r).toBeLessThanOrEqual(8);
    const m = computeMargin({ saleTotal: 30, supplierCost: 11.45, market: MARKETPLACES.EBAY_US, promotedRate: r / 100 });
    expect(m.marginPct).toBeGreaterThanOrEqual(30);
    // 0,1 % de plus ferait passer sous 30 % (ou atteindrait le plafond)
    if (r < 8) expect(computeMargin({ saleTotal: 30, supplierCost: 11.45, market: MARKETPLACES.EBAY_US, promotedRate: (r + 0.1) / 100 }).marginPct).toBeLessThan(30);
    expect(affordableAdRate({ price: 30, cost: 11.45, minMarginPct: 30, marketId: "EBAY_US", cap: 3 })).toBe(3);
  });
  it("marge trop juste : pas de publicité", () => {
    expect(affordableAdRate({ price: 20, cost: 11.45, minMarginPct: 30, marketId: "EBAY_US", cap: 10 })).toBeNull();
    expect(affordableAdRate({ price: 30, cost: 11.45, minMarginPct: 30, marketId: "EBAY_US", cap: 1 })).toBeNull(); // sous le minimum d'eBay
  });
  it("enchère modifiée seulement si l'écart compte", () => {
    expect(adRateChanged(5, 5.3)).toBe(false);
    expect(adRateChanged(5, 4.2)).toBe(true);
    expect(adRateChanged(null, 3)).toBe(true);
    expect(adRateChanged(3, null)).toBe(true);
  });
});

describe("repricing", () => {
  it("concurrents comparables seulement, sans nous ni prix aberrants", () => {
    expect(isComparable("electric can opener", "Automatic Electric Can Opener Hands Free")).toBe(true);
    expect(isComparable("electric can opener", "Garlic press stainless")).toBe(false);
    const items = [
      { id: "v1|111|0", title: "Electric Can Opener", price: 28 },           // nous
      { id: "v1|2|0", title: "Electric Can Opener Automatic", price: 26.5 },
      { id: "v1|3|0", title: "Can Opener Electric Smooth", price: 29.99 },
      { id: "v1|4|0", title: "Electric can opener", price: 9.99 },           // aberrant
      { id: "v1|5|0", title: "Garlic press", price: 5 },                     // autre produit
      { id: "v1|6|0", title: "Electric Can Opener White", price: 31 },
    ];
    expect(competitorPrices("electric can opener", items, "111")).toEqual([26.5, 29.99, 31]);
  });

  const base = { price: 29.99, basePrice: 29.99, cost: 11.45, minMarginPct: 30, marketId: "EBAY_US", undercutPct: 1 };
  it("passe juste sous le moins cher", () => {
    expect(repriceTarget({ ...base, competitors: [27.5, 29, 31] })).toBe(27.22);
  });
  it("jamais sous le prix minimum de marge", () => {
    const t = repriceTarget({ ...base, competitors: [15, 16, 17] })!;
    const m = computeMargin({ saleTotal: t, supplierCost: 11.45, market: MARKETPLACES.EBAY_US });
    expect(m.marginPct).toBeGreaterThanOrEqual(30);
    expect(t).toBeGreaterThan(15);
  });
  it("remonte si les concurrents sont plus chers, plafonné à 1,5 × le prix de départ", () => {
    expect(repriceTarget({ ...base, price: 25, basePrice: 25, competitors: [34, 35, 36] })).toBe(33.66);
    expect(repriceTarget({ ...base, price: 20, basePrice: 20, competitors: [60, 61, 62] })).toBe(30);
  });
  it("rien si trop peu de concurrents ou écart minime", () => {
    expect(repriceTarget({ ...base, competitors: [27, 28] })).toBeNull();
    expect(repriceTarget({ ...base, competitors: [30.25, 31, 32] })).toBeNull();
  });
});
