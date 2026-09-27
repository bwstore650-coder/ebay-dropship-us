import { describe, expect, it } from "vitest";
import { decide, visibleQuantity, type MonitorInput } from "./monitor";

const base: MonitorInput = {
  status: "ACTIVE",
  price: 30.75,
  quantity: 3,
  marketId: "EBAY_US",
  minMarginPct: 30,
  supplier: { found: true, stock: 50, cost: 11.45, deliveryDaysMax: 5 },
};

describe("surveillance du stock et des prix", () => {
  it("tout va bien : rien à faire", () => expect(decide(base)).toEqual({ action: "KEEP", marginPct: 47.9, cost: 11.45 }));
  it("produit retiré ou en rupture chez le fournisseur : pause", () => {
    expect(decide({ ...base, supplier: { found: false } })).toEqual({ action: "PAUSE", reason: "SUPPLIER_GONE" });
    expect(decide({ ...base, supplier: { found: true, stock: 0, cost: 11.45, deliveryDaysMax: 5 } })).toEqual({ action: "PAUSE", reason: "OUT_OF_STOCK" });
  });
  it("plus de livraison rapide : pause", () => {
    expect(decide({ ...base, supplier: { found: true, stock: 9, cost: null, deliveryDaysMax: 99 } })).toMatchObject({ action: "PAUSE", reason: "SLOW" });
    expect(decide({ ...base, supplier: { found: true, stock: 9, cost: 11.45, deliveryDaysMax: 12 } })).toMatchObject({ action: "PAUSE", reason: "SLOW" });
  });
  it("coût en hausse, marge sous le seuil : pause avec le prix minimum conseillé", () => {
    const d = decide({ ...base, supplier: { found: true, stock: 50, cost: 17, deliveryDaysMax: 5 } });
    // Profit 30,75 − 17 − 4,58 = 9,17 → 29,8 % < 30 %
    expect(d).toMatchObject({ action: "PAUSE", reason: "MARGIN", marginPct: 29.8, cost: 17 });
    expect(Number((d as { detail: string }).detail)).toBeGreaterThan(30.75);
  });
  it("stock faible : quantité affichée réduite", () => {
    expect(decide({ ...base, supplier: { found: true, stock: 2, cost: 11.45, deliveryDaysMax: 5 } })).toMatchObject({ action: "SET_QUANTITY", quantity: 2 });
  });
  it("annonce en pause redevenue rentable et en stock : reprise", () => {
    expect(decide({ ...base, status: "PAUSED", quantity: 3 })).toEqual({ action: "RESUME", quantity: 3, marginPct: 47.9, cost: 11.45 });
  });
  it("quantité visible entre 0 et 3", () => {
    expect(visibleQuantity(100)).toBe(3);
    expect(visibleQuantity(1)).toBe(1);
    expect(visibleQuantity(-5)).toBe(0);
  });
});
