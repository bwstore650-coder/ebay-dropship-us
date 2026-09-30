import { describe, expect, it } from "vitest";
import { marketInsights, MAX_CHART_PRICES, monthlySalesEstimate } from "./market-insights";

const now = new Date("2026-09-30T00:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

describe("analyse du marché", () => {
  it("ventes par mois : cumul ÷ mois en ligne (au moins un mois)", () => {
    expect(monthlySalesEstimate([
      { title: "a", price: 20, sold: 120, createdAt: daysAgo(365.28) }, // 12 mois → 10/mois
      { title: "b", price: 22, sold: 6, createdAt: daysAgo(10) },       // moins d'un mois → compté sur 1 mois
      { title: "c", price: 25, sold: 50 },                              // sans date : ignorée
    ], now)).toBe(16);
    expect(monthlySalesEstimate([{ title: "a", price: 1, sold: 3 }], now)).toBeNull();
  });

  it("fourchette de prix, ventes, meilleurs concurrents", () => {
    const r = marketInsights({
      total: 57,
      prices: [30, 18.5, 25, 0, 22],
      analyzed: [
        { title: "Top", price: 25, sold: 40, url: "u1", createdAt: daysAgo(60.88) },
        { title: "None", price: 30, sold: 0, createdAt: daysAgo(30) },
        { title: "Second", price: 22, sold: 12 },
      ],
    }, now);
    expect(r).toMatchObject({
      listings: 57, analyzed: 3, prices: [18.5, 22, 25, 30],
      priceMin: 18.5, priceMedian: 23.5, priceMax: 30, soldTotal: 52, monthlySales: 20,
    });
    expect(r.top).toEqual([{ title: "Top", price: 25, sold: 40, url: "u1" }, { title: "Second", price: 22, sold: 12, url: undefined }]);
  });

  it("marché vide et graphique limité", () => {
    expect(marketInsights({ total: 0, prices: [], analyzed: [] }, now)).toMatchObject({ priceMin: null, priceMedian: null, monthlySales: null, top: [] });
    const many = marketInsights({ total: 100, prices: Array.from({ length: 100 }, (_, i) => i + 1), analyzed: [] }, now);
    expect(many.prices).toHaveLength(MAX_CHART_PRICES);
    expect(many.prices[0]).toBe(1);
    expect(many.priceMax).toBe(100);
  });
});
