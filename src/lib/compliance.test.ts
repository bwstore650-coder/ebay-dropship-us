import { describe, expect, it } from "vitest";
import { checkListing, dailyListingLimit, findVeroBrand, isBlockedSourceUrl } from "./compliance";

describe("conformité", () => {
  it("bloque Amazon et Walmart", () => {
    expect(isBlockedSourceUrl("https://www.amazon.com/dp/B0")).toBe(true);
    expect(isBlockedSourceUrl("https://www.walmart.com/ip/1")).toBe(true);
    expect(isBlockedSourceUrl("https://www.aliexpress.us/item/1.html")).toBe(false);
  });
  it("détecte une marque VeRO", () => {
    expect(findVeroBrand("Case for Apple iPhone 15")).toBe("apple");
    expect(findVeroBrand("Pineapple slicer")).toBeNull();
  });
  it("limites selon l'âge du compte", () => {
    const now = new Date("2026-09-27");
    expect(dailyListingLimit(new Date("2026-09-10"), now)).toBe(5);
    expect(dailyListingLimit(new Date("2026-07-01"), now)).toBe(15);
    expect(dailyListingLimit(new Date("2025-01-01"), now)).toBe(50);
  });
  it("refuse une livraison de 15 jours", () => {
    const r = checkListing({ title: "Lamp", deliveryDaysMax: 15, listedToday: 0, accountOpenedAt: null });
    expect(r.ok).toBe(false);
  });
});
