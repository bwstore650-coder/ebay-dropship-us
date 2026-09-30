import { describe, expect, it } from "vitest";
import { dailySales, normalizeSeller, sellerReport, suggestTitle, titleKeywords, tokenize } from "./research";

const items = [
  { id: "1", title: "Electric Can Opener Automatic Hands Free", price: 30, sold: 100, categoryId: "20667" },
  { id: "2", title: "Automatic Can Opener Electric Smooth Edge", price: 25, sold: 50, categoryId: "20667" },
  { id: "3", title: "Manual Can Opener Stainless Steel", price: 10, sold: 0, categoryId: "20667" },
  { id: "4", title: "Nike Socks Running", price: 12, sold: 30, categoryId: "11450" },
];

describe("espion de concurrents", () => {
  it("rapport : ventes, chiffre d'affaires estimé, taux d'annonces qui vendent, meilleures ventes, catégories", () => {
    const r = sellerReport(items, 250);
    expect(r).toMatchObject({ listings: 4, totalListings: 250, unitsSold: 180, revenue: 4610, avgPrice: 19.25, sellThrough: 75 });
    expect(r.top.map((i) => i.id)).toEqual(["1", "2", "4", "3"]);
    expect(r.categories[0]).toEqual({ categoryId: "20667", listings: 3, unitsSold: 150 });
  });
  it("nom de vendeur depuis un lien ou un pseudo", () => {
    expect(normalizeSeller("https://www.ebay.com/str/Best-Deals4U?_trksid=1")).toBe("best-deals4u");
    expect(normalizeSeller("https://www.ebay.fr/usr/topseller_fr")).toBe("topseller_fr");
    expect(normalizeSeller("https://www.ebay.com/sch/i.html?_ssn=bargainhub&_sop=12")).toBe("bargainhub");
    expect(normalizeSeller("@Some.Seller")).toBe("some.seller");
    expect(normalizeSeller("bad seller name")).toBeNull();
    expect(normalizeSeller("x")).toBeNull();
  });
});

describe("Title Builder", () => {
  it("découpe les titres sans mots vides ni nombres seuls", () => {
    expect(tokenize("NEW Electric Can-Opener for the Kitchen 2 pcs, 100% Free Shipping!")).toEqual(["electric", "can-opener", "kitchen", "pcs"]);
    expect(tokenize("Ouvre-boîte électrique pour la cuisine")).toEqual(["ouvre-boîte", "électrique", "cuisine"]);
  });
  it("mots classés par ventes ; marque protégée signalée", () => {
    const k = titleKeywords(items);
    expect(k.slice(0, 2).map((x) => x.word)).toEqual(["can", "opener"]); // 150 ventes, 3 annonces
    expect(k.slice(2, 4).map((x) => x.word)).toEqual(["automatic", "electric"]); // 150 ventes, 2 annonces
    const can = k.find((x) => x.word === "can")!;
    expect(can).toMatchObject({ listings: 3, sold: 150, score: 83, vero: false });
    expect(k.find((x) => x.word === "nike")).toMatchObject({ vero: true, sold: 30 });
  });
  it("titre proposé ≤ 80 caractères, sans marque protégée", () => {
    const t = suggestTitle(titleKeywords(items));
    expect(t.length).toBeLessThanOrEqual(80);
    expect(t.toLowerCase()).not.toContain("nike");
    expect(t.startsWith("Can ") || t.startsWith("Opener ") || t.startsWith("Electric ") || t.startsWith("Automatic ")).toBe(true);
  });
});

describe("meilleures ventes", () => {
  it("ventes du jour = différence avec le relevé précédent", () => {
    expect(dailySales(120, 100)).toBe(20);
    expect(dailySales(90, 100)).toBe(0);
    expect(dailySales(90, null)).toBeNull();
  });
});
