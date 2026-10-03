import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: {} }));
import { parseTrafficReport } from "./ebay";
import { dayKey, splitDays, sumTraffic } from "./traffic";

const now = Date.parse("2026-10-02T15:00:00Z");

describe("performance (trafic eBay)", () => {
  it("lecture du rapport : une ligne par jour, métriques par nom, non applicables ignorées", () => {
    const rows = parseTrafficReport({
      header: { metrics: [{ key: "TOTAL_IMPRESSION_TOTAL" }, { key: "LISTING_VIEWS_TOTAL" }, { key: "TRANSACTION" }, { key: "SALES_CONVERSION_RATE" }] },
      records: [
        { dimensionValues: [{ value: "20261001" }], metricValues: [{ value: 1000, applicable: true }, { value: 7, applicable: true }, { value: 1, applicable: true }, { value: null, applicable: false }] },
        { dimensionValues: [{ value: "20261002" }], metricValues: [{ value: "2597", applicable: true }, { value: 18 }, { value: 0 }, { value: 0 }] },
      ],
    });
    expect(rows).toEqual([
      { key: "20261001", TOTAL_IMPRESSION_TOTAL: 1000, LISTING_VIEWS_TOTAL: 7, TRANSACTION: 1 },
      { key: "20261002", TOTAL_IMPRESSION_TOTAL: 2597, LISTING_VIEWS_TOTAL: 18, TRANSACTION: 0, SALES_CONVERSION_RATE: 0 },
    ]);
  });

  it("totaux et taux recalculés sur la période, sources d'impressions", () => {
    const t = sumTraffic([
      { key: "a", TOTAL_IMPRESSION_TOTAL: 3000, LISTING_IMPRESSION_SEARCH_RESULTS_PAGE: 2500, LISTING_IMPRESSION_STORE: 100, LISTING_VIEWS_TOTAL: 20, TRANSACTION: 1 },
      { key: "b", TOTAL_IMPRESSION_TOTAL: 597, LISTING_IMPRESSION_SEARCH_RESULTS_PAGE: 500, LISTING_VIEWS_TOTAL: 4, TRANSACTION: 0 },
    ]);
    expect(t).toMatchObject({ impressions: 3597, views: 24, sold: 1, ctr: 0.7, conversion: 4.2, impressionsBySource: { search: 3000, store: 100, other: 497 } });
    expect(sumTraffic([]).ctr).toBeNull();
  });

  it("période actuelle / précédente, jours sans données remplis à zéro", () => {
    expect(dayKey("20261002")).toBe("2026-10-02");
    const { current, previous, series } = splitDays([
      { key: "20260928", TOTAL_IMPRESSION_TOTAL: 5 },  // période précédente (7 jours : 26 sept – 2 oct)
      { key: "20260925", TOTAL_IMPRESSION_TOTAL: 9 },
      { key: "20261002", TOTAL_IMPRESSION_TOTAL: 2597, LISTING_VIEWS_TOTAL: 18 },
    ], 7, now);
    expect(current.map((r) => r.key)).toEqual(["20260928", "20261002"]);
    expect(previous.map((r) => r.key)).toEqual(["20260925"]);
    expect(series).toHaveLength(7);
    expect(series[0]).toEqual({ day: "2026-09-26", impressions: 0, views: 0, sold: 0 });
    expect(series.at(-1)).toEqual({ day: "2026-10-02", impressions: 2597, views: 18, sold: 0 });
  });
});
