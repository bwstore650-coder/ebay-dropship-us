import { describe, expect, it } from "vitest";
import { marketInsights, MAX_CHART_PRICES } from "./market-insights";

describe("analyse du marché", () => {
  it("fourchette de prix, sans totaux de ventes ni liste d'annonces", () => {
    const r = marketInsights({
      total: 57,
      prices: [30, 18.5, 25, 0, 22],
      analyzed: [
        { title: "Top", price: 25, sold: 40, url: "u1" },
        { title: "None", price: 30, sold: 0 },
        { title: "Second", price: 22, sold: 12 },
      ],
    });
    expect(r).toEqual({ listings: 57, analyzed: 3, prices: [18.5, 22, 25, 30], priceMin: 18.5, priceMedian: 23.5, priceMax: 30 });
  });

  it("marché vide et graphique limité", () => {
    expect(marketInsights({ total: 0, prices: [], analyzed: [] })).toMatchObject({ priceMin: null, priceMedian: null, priceMax: null });
    const many = marketInsights({ total: 100, prices: Array.from({ length: 100 }, (_, i) => i + 1), analyzed: [] });
    expect(many.prices).toHaveLength(MAX_CHART_PRICES);
    expect(many.prices[0]).toBe(1);
    expect(many.priceMax).toBe(100);
  });
});
