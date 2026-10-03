import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ soldCalls: 0, imageMatches: [] as unknown[], product: null as unknown }));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/ebay-quota", () => ({ imageBase64: vi.fn(async () => "B64") }));
vi.mock("@/lib/ebay", () => ({
  soldQuantities: vi.fn(async (ids: string[]) => {
    h.soldCalls++;
    return new Map(ids.map((id, i) => [id, i === 0 ? 12 : 3]));
  }),
}));
vi.mock("@/lib/suppliers/aliexpress", () => ({
  imageSearch: vi.fn(async () => h.imageMatches),
  textSearch: vi.fn(async () => []),
  getProduct: vi.fn(async () => h.product),
  localSkus: (p: { skus: { shipsFrom: string; stock: number; price: number }[] }, c: string) => p.skus.filter((s) => s.shipsFrom === c && s.stock > 0).sort((a, b) => a.price - b.price),
  offersFromProduct: vi.fn(async (_c: unknown, _s: unknown, p: { productId: string; title: string; skus: { skuId: string; price: number; stock: number; shipsFrom: string }[] }, country: string) =>
    p.skus.filter((s) => s.shipsFrom === country).map((s) => ({ supplier: "ALIEXPRESS", productId: p.productId, variantId: s.skuId, title: p.title, price: s.price, shipping: 2, stockUs: s.stock, deliveryDaysMax: 5 }))),
}));

import { analyzeEbayGroup, groupListings, usableGroups, wordOverlap } from "./ae-sniper";

const s = { cfg: { appKey: "k", appSecret: "s" }, session: "S" };
const group = {
  title: "Magnetic Car Phone Holder Dashboard Mount 360",
  image: "https://i.ebayimg.com/1.jpg",
  price: 24.99,
  prices: [22.99, 24.99, 26.99],
  itemIds: ["A", "B", "C"],
  createdAt: ["2026-07-01T00:00:00Z", null, null],
  total: 3,
};
const product = (shipsFrom: string, price = 5) => ({
  productId: "1005001", title: "Car Phone Holder Magnetic", images: ["https://ae01.alicdn.com/p.jpg"], descriptionHtml: "", attributes: [],
  skus: [{ skuId: "SKU1", skuAttr: "", price, stock: 50, shipsFrom, label: "" }],
});

beforeEach(() => {
  h.soldCalls = 0;
  h.imageMatches = [{ productId: "1005001", title: "Car Phone Holder", image: null, shipFrom: "US", similarity: 0.95 }];
  h.product = product("US");
});

describe("Sniper AliExpress « eBay d'abord »", () => {
  it("regroupe les annonces du même produit et garde l'ordre de la recherche", () => {
    const groups = groupListings([
      { id: "1", title: "Magnetic Car Phone Holder Dashboard Mount", price: 20, image: "x" },
      { id: "2", title: "Car Phone Holder Magnetic Dashboard Mount", price: 24, image: "y" },
      { id: "3", title: "Silicone Kitchen Spatula Set", price: 15, image: "z" },
      { id: "4", title: "Other listing same photo", price: 30, image: "z" },
    ]);
    expect(groups.map((g) => [g.itemIds, g.price, g.total])).toEqual([[["1", "2"], 22, 2], [["3", "4"], 22.5, 2]]);
    expect(usableGroups([{ ...group, title: "Nike Air Max Running Shoes" }])).toEqual([]); // marque protégée
    expect(wordOverlap("Magnetic Car Phone Holder", "car phone holder stand")).toBeCloseTo(0.75);
  });

  it("aucun appel eBay quand le produit n'est pas expédié depuis le pays", async () => {
    h.product = product("CN");
    const r = await analyzeEbayGroup(s, "EBAY_US", group, { minMarginPct: 30 });
    expect(r.analysis).toMatchObject({ status: "REJECTED", reason: "NO_SUPPLIER" });
    expect(h.soldCalls).toBe(0);
  });

  it("aucun appel eBay quand ce n'est pas rentable", async () => {
    h.product = product("US", 22);
    const r = await analyzeEbayGroup(s, "EBAY_US", group, { minMarginPct: 30 });
    expect(r.analysis).toMatchObject({ status: "REJECTED", reason: "LOW_MARGIN" });
    expect(h.soldCalls).toBe(0);
  });

  it("ventes lues seulement pour un produit disponible et rentable", async () => {
    const r = await analyzeEbayGroup(s, "EBAY_US", group, { minMarginPct: 30 });
    expect(h.soldCalls).toBe(1);
    expect(r.productId).toBe("1005001");
    expect(r.analysis).toMatchObject({ status: "PROFITABLE", unitsSold: 18, variantId: "SKU1", title: "Car Phone Holder Magnetic" });
    expect(r.analysis.details.market?.analyzed).toBe(3);
  });

  it("photo trop différente : pas de correspondance", async () => {
    h.imageMatches = [{ productId: "1005001", title: "x", image: null, shipFrom: "US", similarity: 0.3 }];
    const r = await analyzeEbayGroup(s, "EBAY_US", group, { minMarginPct: 30 });
    expect(r.analysis.reason).toBe("NO_SUPPLIER");
  });
});
