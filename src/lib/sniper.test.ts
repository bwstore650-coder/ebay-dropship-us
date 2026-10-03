import { describe, expect, it } from "vitest";
import { CATEGORY_IDS, classify, inCostRange, isCategoryId, isFinished, keywordFromTitle, maxScan, parseKeywords, PRODUCT_CATEGORIES, SCANNER_SEEDS, seedsForCategories } from "./sniper";
import type { Evaluation } from "./margin";

const ev = (over: Partial<Evaluation> = {}): Evaluation => ({
  verdict: "RENTABLE",
  marketPrice: 30,
  best: { supplier: "CJ", productId: "P", title: "x", price: 8, shipping: 4, stockUs: 10, deliveryDaysMax: 5 },
  margin: { saleTotal: 30, landedCost: 12, fees: 4.5, profit: 13.5, marginPct: 45 },
  minPriceForTarget: 22,
  ...over,
});

describe("mots-clés", () => {
  it("titre fournisseur → recherche eBay courte, sans bruit ni tailles", () => {
    expect(keywordFromTitle("2024 New Hot Sale Electric Can Opener Automatic Hands-Free 12cm Kitchen Tool")).toBe("electric can opener automatic hands-free");
    expect(keywordFromTitle("【Upgraded】 LED Motion Sensor Closet Light (3 PCS) Rechargeable 1200mAh")).toBe("led motion sensor closet light");
    expect(keywordFromTitle("Pet Dog Dog Hair Remover Roller")).toBe("pet dog hair remover roller");
    expect(keywordFromTitle("2024 New 10pcs")).toBe("");
  });
  it("liste collée : une par ligne ou virgule, sans doublons, 50 maximum", () => {
    expect(parseKeywords("electric can opener\n  LED light , led light;\n\nx\npet brush")).toEqual(["electric can opener", "LED light", "pet brush"]);
    expect(parseKeywords(Array.from({ length: 80 }, (_, i) => `kw ${i}`).join("\n"))).toHaveLength(50);
  });
});

describe("tri des produits", () => {
  it("rentable avec de vraies ventes : gardé", () => {
    expect(classify(ev(), { unitsSold: 12 })).toEqual({ status: "PROFITABLE" });
  });
  it("high ticket : rejeté sous 100 de profit, gardé au-dessus", () => {
    expect(classify(ev(), { unitsSold: 12, minProfit: 100 })).toEqual({ status: "REJECTED", reason: "LOW_PROFIT" });
    const big = ev({ marketPrice: 420, margin: { saleTotal: 420, landedCost: 210, fees: 60, profit: 150, marginPct: 35.7 } });
    expect(classify(big, { unitsSold: 5, minProfit: 100 })).toEqual({ status: "PROFITABLE" });
  });
  it("écarté : marge, demande, prix, fournisseur, fourchette, marque protégée", () => {
    expect(classify(ev({ verdict: "TROP_FAIBLE" }), { unitsSold: 50 })).toEqual({ status: "REJECTED", reason: "LOW_MARGIN" });
    expect(classify(ev(), { unitsSold: 1 })).toEqual({ status: "REJECTED", reason: "NO_DEMAND" });
    expect(classify(ev({ verdict: "PAS_DE_PRIX", marketPrice: null }), { unitsSold: 0 })).toEqual({ status: "REJECTED", reason: "NO_PRICE" });
    expect(classify(ev({ verdict: "PAS_DE_FOURNISSEUR" }), { unitsSold: 9 })).toEqual({ status: "REJECTED", reason: "NO_SUPPLIER" });
    expect(classify(ev(), { unitsSold: 9, priceMin: 40 })).toEqual({ status: "REJECTED", reason: "PRICE_RANGE" });
    expect(classify(ev(), { unitsSold: 9, priceMax: 25 })).toEqual({ status: "REJECTED", reason: "PRICE_RANGE" });
    expect(classify(ev(), { unitsSold: 9, priceMin: 20, priceMax: 35 })).toEqual({ status: "PROFITABLE" });
    expect(classify(ev(), { unitsSold: 99, title: "Nike Running Socks" })).toEqual({ status: "REJECTED", reason: "VERO" });
  });
});

describe("fin de la recherche", () => {
  it("objectif atteint, liste épuisée, ou assez de produits parcourus", () => {
    expect(isFinished({ mode: "CATALOG", target: 5, found: 5, scanned: 9, pending: 3, exhausted: false })).toBe(true);
    expect(isFinished({ mode: "KEYWORDS", target: 5, found: 1, scanned: 9, pending: 0, exhausted: false })).toBe(true);
    expect(isFinished({ mode: "KEYWORDS", target: 5, found: 1, scanned: 9, pending: 2, exhausted: false })).toBe(false);
    expect(isFinished({ mode: "CATALOG", target: 5, found: 1, scanned: 10, pending: 0, exhausted: false })).toBe(false);
    expect(isFinished({ mode: "CATALOG", target: 5, found: 1, scanned: maxScan(5), pending: 0, exhausted: false })).toBe(true);
    expect(isFinished({ mode: "CATALOG", target: 5, found: 1, scanned: 3, pending: 0, exhausted: true })).toBe(true);
    expect(maxScan(1)).toBe(25);
    expect(maxScan(10)).toBe(250);
    expect(maxScan(50)).toBe(400);
    // « Continuer la recherche » : la limite enregistrée remplace celle calculée.
    expect(isFinished({ mode: "CATALOG", target: 5, found: 1, scanned: maxScan(5), pending: 0, exhausted: false, scanLimit: maxScan(5) * 2 })).toBe(false);
    expect(isFinished({ mode: "CATALOG", target: 5, found: 1, scanned: maxScan(5) * 2, pending: 0, exhausted: false, scanLimit: maxScan(5) * 2 })).toBe(true);
  });
});

describe("catégories et prix d'achat", () => {
  it("thèmes des catégories choisies, sans doublon ; catégories inconnues ignorées", () => {
    expect(seedsForCategories(["pets", "kitchen"])).toEqual(["kitchen gadget", "kitchen tools", "kitchen storage", "pet supplies", "dog toys", "cat toys"]);
    expect(seedsForCategories(["inconnue"])).toEqual([]);
    expect(isCategoryId("garden")).toBe(true);
    expect(isCategoryId("weapons")).toBe(false);
    expect(new Set(CATEGORY_IDS).size).toBe(PRODUCT_CATEGORIES.length);
    // Le scanner de fond couvre toutes les catégories.
    for (const c of PRODUCT_CATEGORIES) for (const seed of c.seeds) expect(SCANNER_SEEDS).toContain(seed);
  });
  it("fourchette de prix d'achat : bornes facultatives", () => {
    expect(inCostRange(8, null, null)).toBe(true);
    expect(inCostRange(8, 5, 10)).toBe(true);
    expect(inCostRange(4.99, 5, null)).toBe(false);
    expect(inCostRange(10.01, null, 10)).toBe(false);
    expect(inCostRange(null, 5, 10)).toBe(false);
  });
  it("produit hors de la fourchette d'achat : rejeté (avant marge et demande)", () => {
    expect(classify(ev(), { unitsSold: 12, costMin: 10 })).toEqual({ status: "REJECTED", reason: "COST_RANGE" });
    expect(classify(ev(), { unitsSold: 12, costMax: 5 })).toEqual({ status: "REJECTED", reason: "COST_RANGE" });
    expect(classify(ev(), { unitsSold: 12, costMin: 5, costMax: 10 })).toEqual({ status: "PROFITABLE" });
  });
});


describe("ventes estimées minimum", async () => {
  const { classify, meetsMonthlySales } = await import("./sniper");
  it("sans minimum tout passe ; inconnues = refusé quand un minimum est choisi", () => {
    expect(meetsMonthlySales(null, null)).toBe(true);
    expect(meetsMonthlySales(3, 0)).toBe(true);
    expect(meetsMonthlySales(12, 10)).toBe(true);
    expect(meetsMonthlySales(9, 10)).toBe(false);
    expect(meetsMonthlySales(null, 10)).toBe(false);
  });
  it("un produit rentable sous le minimum est refusé (LOW_SALES)", () => {
    const e = { verdict: "RENTABLE", marketPrice: 30, best: { supplier: "CJ", productId: "P", variantId: "V", title: "Can opener", price: 8, shipping: 3, stockUs: 10, deliveryDaysMax: 5 }, margin: { profit: 9, marginPct: 30, landedCost: 11, fees: 5 }, minPriceForTarget: 20 } as never;
    expect(classify(e, { unitsSold: 50, monthlySales: 4, minMonthlySales: 10 })).toEqual({ status: "REJECTED", reason: "LOW_SALES" });
    expect(classify(e, { unitsSold: 50, monthlySales: 15, minMonthlySales: 10 })).toEqual({ status: "PROFITABLE" });
    expect(classify(e, { unitsSold: 50 })).toEqual({ status: "PROFITABLE" });
  });
});
