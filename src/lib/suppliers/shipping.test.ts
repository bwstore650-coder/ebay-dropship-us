import { describe, expect, it } from "vitest";
import { pickShipping } from "./shipping";
import { pickBestOffer, type SupplierOffer } from "@/lib/margin";

const opt = (name: string, price: number, days: number) => ({ name, price, days });
const pick = (list: ReturnType<typeof opt>[]) => pickShipping(list, (o) => o.price, (o) => o.days)?.name ?? null;

describe("choix de la livraison", () => {
  it("le moins cher parmi les modes rapides, pas le moins cher tout court", () => {
    expect(pick([opt("lent", 2.9, 15), opt("rapide", 3.4, 5), opt("express", 9, 2)])).toBe("rapide");
  });
  it("à prix égal, le plus rapide", () => {
    expect(pick([opt("a", 3, 7), opt("b", 3, 4)])).toBe("b");
  });
  it("aucun mode rapide : le plus rapide (refusé ensuite comme trop lent)", () => {
    expect(pick([opt("a", 2, 20), opt("b", 5, 12)])).toBe("b");
  });
  it("aucun mode : rien", () => {
    expect(pick([])).toBeNull();
  });
});

const offer = (o: Partial<SupplierOffer>): SupplierOffer => ({ supplier: "CJ", productId: "P", variantId: "V", title: "t", price: 8, shipping: 3, stockUs: 10, deliveryDaysMax: 6, ...o });

describe("choix du fournisseur", () => {
  it("coût livré le plus bas, entrepôt du pays et livraison ≤ 8 jours seulement", () => {
    const best = pickBestOffer([
      offer({ supplier: "CJ", price: 9, shipping: 3 }),
      offer({ supplier: "ALIEXPRESS", price: 7, shipping: 2.5 }),
      offer({ supplier: "CJ", variantId: "CN", price: 4, shipping: 2, deliveryDaysMax: 15 }), // trop lent
      offer({ supplier: "CJ", variantId: "OUT", price: 3, shipping: 1, stockUs: 0 }), // pas de stock local
    ]);
    expect(best?.supplier).toBe("ALIEXPRESS");
  });
  it("à quelques centimes près, le plus rapide l'emporte", () => {
    const best = pickBestOffer([offer({ variantId: "SLOW", price: 8, shipping: 3, deliveryDaysMax: 8 }), offer({ variantId: "FAST", price: 8.2, shipping: 3, deliveryDaysMax: 4 })]);
    expect(best?.variantId).toBe("FAST");
    const clear = pickBestOffer([offer({ variantId: "SLOW", price: 8, shipping: 3, deliveryDaysMax: 8 }), offer({ variantId: "FAST", price: 10, shipping: 3, deliveryDaysMax: 4 })]);
    expect(clear?.variantId).toBe("SLOW");
  });
});
