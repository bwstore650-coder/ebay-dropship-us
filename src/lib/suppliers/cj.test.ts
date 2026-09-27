import { describe, expect, it } from "vitest";
import { parseMaxDays, productImages, type CjProduct } from "./cj";

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
