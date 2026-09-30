import { describe, expect, it } from "vitest";
import { cjProductUrl, ebaySearchUrl } from "./listing";

describe("liens produit", () => {
  it("recherche eBay du bon pays", () => {
    expect(ebaySearchUrl("EBAY_US", "car floor mats ford")).toBe("https://www.ebay.com/sch/i.html?_nkw=car+floor+mats+ford");
    expect(ebaySearchUrl("EBAY_DE", "lampe")).toMatch(/^https:\/\/www\.ebay\.de\/sch\/i\.html\?_nkw=lampe$/);
  });
  it("fiche CJ avec le titre en slug", () => {
    expect(cjProductUrl("04A2-XYZ", "Car Floor Mats For 2021-2023 Ford Bronco!")).toBe("https://cjdropshipping.com/product/car-floor-mats-for-2021-2023-ford-bronco-p-04A2-XYZ.html");
    expect(cjProductUrl("P1", null)).toBe("https://cjdropshipping.com/product/product-p-P1.html");
    // Titre coupé sur un séparateur : pas de double tiret avant « -p- ».
    expect(cjProductUrl("9", "a".repeat(79) + " b")).toBe(`https://cjdropshipping.com/product/${"a".repeat(79)}-p-9.html`);
  });
});
