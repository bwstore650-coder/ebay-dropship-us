import { beforeEach, describe, expect, it, vi } from "vitest";
import { getProduct, parseMaxDays, productImages, toOffers, type CjProduct } from "./cj";

const base: CjProduct = { pid: "1", productNameEn: "x", sellPrice: 1, variants: [] };

describe("CJ", () => {
  it("images : liste JSON, URL séparées par des virgules, variante en premier", () => {
    const p = { ...base, productImage: '["https://a.com/1.jpg","https://a.com/2.jpg"]', productImageSet: ["https://a.com/3.jpg"] };
    expect(productImages(p, { vid: "v", variantSku: "s", variantSellPrice: 1, variantImage: "https://a.com/v.jpg" })).toEqual([
      "https://a.com/v.jpg", "https://a.com/1.jpg", "https://a.com/2.jpg", "https://a.com/3.jpg",
    ]);
    expect(productImages({ ...base, productImage: "https://a.com/1.jpg,https://a.com/2.jpg" })).toEqual(["https://a.com/1.jpg", "https://a.com/2.jpg"]);
    expect(productImages(base)).toEqual([]);
  });
  it("délai maximum", () => {
    expect(parseMaxDays("3-8")).toBe(8);
    expect(parseMaxDays(undefined)).toBe(99);
  });
});

const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
let paths: string[] = [];

describe("fiche produit CJ : stock par pays", () => {
  beforeEach(() => {
    paths = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const u = new URL(url);
      paths.push(u.pathname.replace("/api2.0/v1", ""));
      if (u.pathname.endsWith("/product/query"))
        return json({ code: 200, result: true, message: "Success", data: {
          pid: "P1", productNameEn: "Phone Holder", sellPrice: 8,
          variants: [
            { vid: "V1", variantSku: "S1", variantSellPrice: 8, inventories: null },
            { vid: "V2", variantSku: "S2", variantSellPrice: 9, inventories: null },
            { vid: "V3", variantSku: "S3", variantSellPrice: 9, inventories: null },
          ],
        } });
      // Réponse réelle de CJ : « success » et non « result ».
      if (u.pathname.endsWith("/product/stock/getInventoryByPid"))
        return json({ success: true, code: 200, message: "", data: { variantInventories: [
          { vid: "V1", inventory: [{ countryCode: "US", totalInventory: 140 }, { countryCode: "CN", totalInventory: 900 }] },
          { vid: "V2", inventory: [{ countryCode: "CN", totalInventory: 50 }] },
        ] } });
      if (u.pathname.endsWith("/logistic/freightCalculate"))
        return json({ code: 200, result: true, message: "Success", data: [
          { logisticName: "USPS US to US #2", logisticPrice: 0, logisticAging: "3-7" },
          { logisticName: "USPS US to US #17", logisticPrice: 1.5, logisticAging: "3-8" },
        ] });
      return json({ code: 1600101, result: false, message: "Interface not found", data: null });
    }));
  });

  it("complète le stock des variantes quand la fiche ne le donne pas", async () => {
    const p = await getProduct("T", "P1");
    expect(paths).toEqual(["/product/query", "/product/stock/getInventoryByPid"]);
    expect(p.variants.map((v) => v.inventories)).toEqual([
      [{ countryCode: "US", totalInventory: 140 }, { countryCode: "CN", totalInventory: 900 }],
      [{ countryCode: "CN", totalInventory: 50 }],
      [],
    ]);
  });

  it("offres : seulement les variantes en stock dans le pays, avec la livraison la moins chère", async () => {
    const offers = await toOffers("T", await getProduct("T", "P1"), "US");
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ variantId: "V1", price: 8, shipping: 0, stockUs: 140, deliveryDaysMax: 7 });
  }, 15000);

  it("stock déjà présent dans la fiche : pas d'appel en plus", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ code: 200, result: true, message: "Success", data: {
      pid: "P2", productNameEn: "X", sellPrice: 5, variants: [{ vid: "V9", variantSku: "S9", variantSellPrice: 5, inventories: [{ countryCode: "US", totalInventory: 3 }] }],
    } })));
    const p = await getProduct("T2", "P2");
    expect(p.variants[0].inventories).toEqual([{ countryCode: "US", totalInventory: 3 }]);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
});

describe("limite CJ d'un appel par seconde", () => {
  it("réessaie après « Too Many Requests », puis abandonne", async () => {
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      n++;
      if (n === 1) return json({ code: 1600200, result: false, message: "Too Many Requests, QPS limit is 1 time/1second", data: null });
      return json({ code: 200, result: true, message: "Success", data: { pid: "P3", productNameEn: "X", sellPrice: 1, variants: [] } });
    }));
    expect((await getProduct("T3", "P3")).pid).toBe("P3");
    expect(n).toBe(2);

    vi.stubGlobal("fetch", vi.fn(async () => json({ code: 1600200, result: false, message: "Too Many Requests", data: null })));
    await expect(getProduct("T4", "P4")).rejects.toThrow(/Too Many Requests/);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(4);
  }, 30000);
});
