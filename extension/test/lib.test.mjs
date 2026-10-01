import { describe, expect, it } from "vitest";
import { badgeFor, cjProductIdFromUrl, fill, money, newEvents, onboardingLeft, pickLocale, shouldWarnLowBalance } from "../src/lib.js";

describe("extension : outils", () => {
  it("identifiant produit depuis l'adresse CJ", () => {
    expect(cjProductIdFromUrl("https://cjdropshipping.com/product/electric-can-opener-p-04A22450-67F0-4617-A132-E7AE7A8963B0.html")).toBe("04A22450-67F0-4617-A132-E7AE7A8963B0");
    expect(cjProductIdFromUrl("https://www.cjdropshipping.com/product/led-strip-p-light-p-1625321476425166848.html?from=x")).toBe("1625321476425166848");
    expect(cjProductIdFromUrl("https://cjdropshipping.com/product-detail.html?id=1625321476425166848")).toBe("1625321476425166848");
    expect(cjProductIdFromUrl("https://cjdropshipping.com/search/can-opener.html")).toBeNull();
    expect(cjProductIdFromUrl("https://evil-cjdropshipping.com/product/x-p-1625321476425166848.html")).toBeNull();
    expect(cjProductIdFromUrl("https://cjdropshipping.com/product/x-p-<script>.html")).toBeNull();
    expect(cjProductIdFromUrl("pas une adresse")).toBeNull();
  });
  it("langue : compte, puis navigateur, puis anglais", () => {
    expect(pickLocale("fr", "de-DE")).toBe("fr");
    expect(pickLocale(null, "de-DE")).toBe("de");
    expect(pickLocale("pt", "ja")).toBe("en");
  });
  it("textes et montants", () => {
    expect(fill("{n} commandes", { n: 3 })).toBe("3 commandes");
    expect(fill("{x} reste", {})).toBe("{x} reste");
    expect(money(12.5, "USD", "en")).toBe("$12.50");
    expect(money(null)).toBe("—");
  });
  it("badge : commandes à vérifier d'abord, puis solde CJ bas", () => {
    expect(badgeFor({ counts: { ordersToCheck: 3 }, cj: { low: true } })).toEqual({ text: "3", color: "#dc2626" });
    expect(badgeFor({ counts: { ordersToCheck: 120 } }).text).toBe("99+");
    expect(badgeFor({ counts: { ordersToCheck: 0 }, cj: { low: true } })).toEqual({ text: "!", color: "#d97706" });
    expect(badgeFor({ counts: { ordersToCheck: 0 }, cj: { low: false } }).text).toBe("");
  });
  it("notifications : seulement les nouveaux événements, liste bornée", () => {
    const r = newEvents([{ id: "a" }, { id: "b" }], ["b"], 2);
    expect(r.fresh.map((e) => e.id)).toEqual(["a"]);
    expect(r.ids).toEqual(["a", "b"]);
    expect(newEvents(undefined, undefined)).toEqual({ fresh: [], ids: [] });
  });
  it("rappel solde bas toutes les 12 h au plus, étapes de démarrage restantes", () => {
    const s = { cj: { low: true } };
    expect(shouldWarnLowBalance(s, null, 1000, 500)).toBe(true);
    expect(shouldWarnLowBalance(s, 800, 1000, 500)).toBe(false);
    expect(shouldWarnLowBalance({ cj: { low: false } }, null, 1000, 500)).toBe(false);
    expect(onboardingLeft({ plan: true, ebay: false, supplier: true, firstListing: false })).toEqual(["ebay", "firstListing"]);
  });
});

import { cjProductUrl, errorKey, isToken, safeUrl } from "../src/lib.js";

describe("extension : liens et erreurs", () => {
  it("lien CJ identique à celui du site, et relu correctement", () => {
    const url = cjProductUrl("1625321476425166848", "LED Strip — 5m RGB!");
    expect(url).toBe("https://cjdropshipping.com/product/led-strip-5m-rgb-p-1625321476425166848.html");
    expect(cjProductIdFromUrl(url)).toBe("1625321476425166848");
  });
  it("erreurs, jeton, adresses autorisées", () => {
    expect(errorKey("EBAY_QUOTA")).toBe("errQuota");
    expect(errorKey("WHATEVER")).toBe("errGeneric");
    expect(isToken("svx_" + "a".repeat(43))).toBe(true);
    expect(isToken("abc")).toBe(false);
    const base = "https://sellvela.vercel.app";
    expect(safeUrl("https://sellvela.vercel.app/orders", base)).toBe("https://sellvela.vercel.app/orders");
    expect(safeUrl("https://www.cjdropshipping.com/x", base)).toBe("https://www.cjdropshipping.com/x");
    expect(safeUrl("https://evil.example/", base)).toBeNull();
    expect(safeUrl("javascript:alert(1)", base)).toBeNull();
  });
});
