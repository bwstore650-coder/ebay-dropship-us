import { describe, expect, it } from "vitest";
import { niceTicks, priceBins } from "./SniperProductCard";

describe("graphique des prix concurrents", () => {
  it("graduations rondes", () => {
    expect(niceTicks(37.7, 175.2)).toEqual([50, 100, 150]);
    expect(niceTicks(0, 10)).toEqual([0, 2.5, 5, 7.5, 10]);
  });
  it("classes de prix : chaque annonce comptée une fois, la plus chère dans la dernière classe", () => {
    const bins = priceBins([10, 12, 19, 20, 30], 10, 30, 4);
    expect(bins.map((b) => b.count)).toEqual([2, 1, 1, 1]);
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(5);
  });
});
