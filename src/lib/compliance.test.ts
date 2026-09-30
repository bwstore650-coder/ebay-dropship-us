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
    // Imitations sans la marque dans le titre.
    expect(findVeroBrand("24 Ultra Cell Phone 8GB-256GB Unlocked Phone 5G Smartphone With Tool Pen Android")).toBe("samsung");
    expect(findVeroBrand("S25 Ultra 5G smartphone dual SIM")).toBe("samsung");
    expect(findVeroBrand("i16 Pro Max unlocked cell phone")).toBe("apple");
    expect(findVeroBrand("Retro Jordan 1 basketball sneakers")).toBe("nike");
    expect(findVeroBrand("Wireless earbuds compatible AirPods case")).toBe("airpods");
    // Pas de faux positifs sur des produits génériques.
    expect(findVeroBrand("Ultra bright 24 LED flashlight")).toBeNull();
    expect(findVeroBrand("Galaxy star projector night light")).toBeNull();
    expect(findVeroBrand("Phone holder for car, 360 rotation")).toBeNull();
    expect(findVeroBrand("Car floor mats for 2021-2023 Ford Bronco")).toBeNull();
    // Nom de modèle Galaxy sur un téléphone générique.
    expect(findVeroBrand("A17 Unlocked Phone Ultra 8GB 256GB Smartphone Android 15 Phone,6800mAh Battery 5G Dual SIM")).toBe("samsung");
    expect(findVeroBrand("M34 android smartphone 128GB")).toBe("samsung");
    expect(findVeroBrand("A4 paper holder, S10 storage box")).toBeNull();
    expect(findVeroBrand("Kids smartwatch with SIM, android, 4G")).toBeNull();
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

describe("détaillants interdits hors US", () => {
  it("bloque Amazon UK, Canada, Australie", () => {
    expect(isBlockedSourceUrl("https://www.amazon.co.uk/dp/1")).toBe(true);
    expect(isBlockedSourceUrl("https://www.amazon.ca/dp/1")).toBe(true);
    expect(isBlockedSourceUrl("https://www.amazon.com.au/dp/1")).toBe(true);
    expect(isBlockedSourceUrl("https://www.cjdropshipping.com/product/x")).toBe(false);
  });
});
