import { describe, expect, it } from "vitest";
import { convertFromUsd, offersToCurrency } from "./fx";

const rates = { USD: 1, CAD: 1.4, GBP: 0.8, AUD: 1.5 };

describe("change", () => {
  it("USD inchangé", () => expect(convertFromUsd(10, "USD", rates)).toBe(10));
  it("convertit avec 2 % de marge de sécurité", () => {
    expect(convertFromUsd(10, "CAD", rates)).toBe(14.28);
    expect(convertFromUsd(10, "GBP", rates)).toBe(8.16);
  });
  it("refuse une devise sans taux", () => expect(() => convertFromUsd(10, "EUR", rates)).toThrow());
  it("convertit prix et livraison des offres", () => {
    const [o] = offersToCurrency([{ supplier: "CJ", productId: "p", title: "t", price: 10, shipping: 5, stockUs: 1, deliveryDaysMax: 5 }], "AUD", rates);
    expect(o.price).toBe(15.3);
    expect(o.shipping).toBe(7.65);
  });
});
