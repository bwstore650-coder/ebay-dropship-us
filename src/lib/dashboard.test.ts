import { describe, expect, it } from "vitest";
import { change, dailySeries, ordersByMarket, topProducts, totals, type DashOrder } from "./dashboard";

const now = new Date("2026-09-30T15:00:00Z");
const ago = (d: number) => new Date(now.getTime() - d * 86_400_000);
const o = (d: number, sale: number, profit: number, extra: Partial<DashOrder> = {}): DashOrder => ({
  status: "SHIPPED", currency: "USD", marketplace: "EBAY_US", saleTotal: sale, profit, createdAt: ago(d),
  lines: [{ title: "Can opener", quantity: 1, listingId: "L1" }], ...extra,
});

const orders = [
  o(0, 30, 12, { fees: 4.2, supplierCost: 13.8 }),
  o(2, 25, 9, { lines: [{ title: "Closet light", quantity: 2, listingId: "L2" }] }),
  o(2, 30, 11),
  o(5, 40, 15, { status: "NEEDS_REVIEW" }),            // pas passée : ignorée
  o(40, 20, 5),                                          // période précédente
  o(1, 19.9, 6, { currency: "EUR", marketplace: "EBAY_DE" }),
];

describe("tableau de bord", () => {
  it("totaux d'une période et d'une devise", () => {
    expect(totals(orders, "USD", ago(30), ago(-1))).toEqual({ orders: 3, revenue: 85, profit: 32, units: 4, fees: 4.2, supplierCost: 13.8 });
    expect(totals(orders, "USD", ago(60), ago(30))).toEqual({ orders: 1, revenue: 20, profit: 5, units: 1, fees: 0, supplierCost: 0 });
    expect(totals(orders, "EUR", ago(30), ago(-1)).orders).toBe(1);
  });
  it("évolution en %", () => {
    expect(change(85, 20)).toBe(325);
    expect(change(10, 20)).toBe(-50);
    expect(change(10, 0)).toBeNull();
  });
  it("une valeur par jour, le plus ancien en premier", () => {
    const s = dailySeries(orders, "USD", 7, now);
    expect(s).toHaveLength(7);
    expect(s[6]).toMatchObject({ day: "2026-09-30", revenue: 30, profit: 12, orders: 1 });
    expect(s[4]).toMatchObject({ day: "2026-09-28", revenue: 55, profit: 20, orders: 2 });
    expect(s.reduce((a, p) => a + p.orders, 0)).toBe(3);
  });
  it("meilleurs produits par profit", () => {
    expect(topProducts(orders, "USD")).toEqual([
      { title: "Can opener", orders: 3, units: 3, revenue: 80, profit: 28 },
      { title: "Closet light", orders: 1, units: 2, revenue: 25, profit: 9 },
    ]);
  });
  it("commandes par pays", () => {
    expect(ordersByMarket(orders)).toEqual([{ marketplace: "EBAY_US", orders: 4 }, { marketplace: "EBAY_DE", orders: 1 }]);
  });
});
