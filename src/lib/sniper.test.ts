import { describe, expect, it } from "vitest";
import { classify, isFinished, keywordFromTitle, maxScan, parseKeywords } from "./sniper";
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
    expect(maxScan(1)).toBe(20);
    expect(maxScan(50)).toBe(150);
  });
});
