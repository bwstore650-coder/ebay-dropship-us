import { MARKETPLACES } from "./marketplaces";
import { describe, expect, it } from "vitest";
import { weightedMedian, computeMargin, ebayFees, evaluateProduct, median, pickBestOffer, priceForTargetMargin, type SupplierOffer } from "./margin";

describe("frais eBay", () => {
  it("13,6 % + 0,40 $ au-dessus de 10 $", () => {
    expect(ebayFees(30.75)).toBe(4.58);
  });
  it("0,30 $ à 10 $ ou moins", () => {
    expect(ebayFees(9.99)).toBe(1.66);
  });
});

describe("marge (chiffres du test du 27/09/2026)", () => {
  it("ouvre-boîte CJ : 30,75 $ vendu, 11,45 $ livré → 14,72 $", () => {
    const r = computeMargin({ saleTotal: 30.75, supplierCost: 11.45 });
    expect(r.profit).toBe(14.72);
    expect(r.marginPct).toBe(47.9);
  });
  it("lampes AliExpress avec 7 % de taxe → 20,04 $", () => {
    const r = computeMargin({ saleTotal: 40.33, supplierCost: 13.47, supplierTaxRate: 0.07 });
    expect(r.profit).toBe(20.04);
  });
  it("fontaine CJ à perte", () => {
    expect(computeMargin({ saleTotal: 41.64, supplierCost: 53.93 }).profit).toBeLessThan(0);
  });
});

describe("prix minimum pour la marge visée", () => {
  it("atteint bien 30 %", () => {
    const p = priceForTargetMargin(11.45, 30);
    expect(computeMargin({ saleTotal: p, supplierCost: 11.45 }).marginPct).toBeGreaterThanOrEqual(30);
  });
});

const offer = (o: Partial<SupplierOffer>): SupplierOffer => ({
  supplier: "CJ", productId: "p", title: "t", price: 10, shipping: 0, stockUs: 10, deliveryDaysMax: 5, ...o,
});

describe("meilleure offre", () => {
  it("prend le moins cher livré, en stock, ≤ 8 jours", () => {
    const best = pickBestOffer([
      offer({ productId: "cher", price: 20 }),
      offer({ productId: "rupture", price: 5, stockUs: 0 }),
      offer({ productId: "lent", price: 5, deliveryDaysMax: 15 }),
      offer({ productId: "bon", price: 12, shipping: 2 }),
    ]);
    expect(best?.productId).toBe("bon");
  });
});

describe("évaluation d'un produit", () => {
  it("médiane", () => expect(median([10, 30, 20])).toBe(20));
  it("RENTABLE si marge ≥ seuil", () => {
    const e = evaluateProduct([29, 30.75, 32], [offer({ price: 11.45 })]);
    expect(e.verdict).toBe("RENTABLE");
  });
  it("TROP_FAIBLE sinon", () => {
    const e = evaluateProduct([24.98], [offer({ price: 19.01, supplier: "ALIEXPRESS", taxRate: 0.07 })]);
    expect(e.verdict).toBe("TROP_FAIBLE");
  });
  it("PAS_DE_FOURNISSEUR si aucune offre valide", () => {
    expect(evaluateProduct([20], [offer({ stockUs: 0 })]).verdict).toBe("PAS_DE_FOURNISSEUR");
  });
});

describe("médiane pondérée par les ventes", () => {
  it("ignore les annonces qui ne vendent pas", () => {
    expect(weightedMedian([{ price: 15, weight: 0 }, { price: 25, weight: 40 }, { price: 60, weight: 2 }])).toBe(25);
  });
  it("null sans aucune vente", () => {
    expect(weightedMedian([{ price: 15, weight: 0 }])).toBeNull();
  });
});


describe("frais par pays", () => {
  it("Canada = mêmes taux que les US", () => {
    expect(ebayFees(30.75, { market: MARKETPLACES.EBAY_CA })).toBe(4.58);
  });
  it("Royaume-Uni : 12,9 % + 0,40 £, TVA 20 % sur les frais", () => {
    expect(ebayFees(30, { market: MARKETPLACES.EBAY_GB })).toBe(5.12);
  });
  it("le prix pour 30 % tient compte de la TVA sur les frais", () => {
    const m = MARKETPLACES.EBAY_GB;
    const p = priceForTargetMargin(10, 30, { market: m });
    expect(computeMargin({ saleTotal: p, supplierCost: 10, market: m }).marginPct).toBeGreaterThanOrEqual(30);
  });
  it("Australie : frais fixe 0,30 A$", () => {
    expect(ebayFees(20, { market: MARKETPLACES.EBAY_AU })).toBe(2.98);
  });
});
