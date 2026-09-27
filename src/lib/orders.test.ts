import { describe, expect, it } from "vitest";
import type { EbayOrder } from "./ebay";
import { checkOrderable, shipAddress, ebayCarrierCode, isBalanceError, isDuplicateError, mapLines, orderProfit, supplierOrderNumber } from "./orders";

const order = (o: Partial<EbayOrder> = {}): EbayOrder => ({
  orderId: "12-34567-89012",
  creationDate: "2026-09-27T10:00:00.000Z",
  orderFulfillmentStatus: "NOT_STARTED",
  orderPaymentStatus: "PAID",
  cancelStatus: { cancelState: "NONE_REQUESTED" },
  pricingSummary: { total: { value: "30.75", currency: "USD" } },
  lineItems: [{ lineItemId: "L1", sku: "PL-A", quantity: 1, title: "Can opener" }],
  fulfillmentStartInstructions: [{ shippingStep: { shipTo: { fullName: "Jane Doe", primaryPhone: { phoneNumber: "(555) 123-4567" }, contactAddress: { addressLine1: "1 Main St", city: "Austin", stateOrProvince: "TX", postalCode: "73301", countryCode: "US" } } } }],
  ...o,
});

describe("commandes : quelles ventes commander", () => {
  it("payée, non annulée, adresse complète : oui", () => expect(checkOrderable(order())).toEqual({ ok: true }));
  it("non payée, annulée, déjà expédiée, sans adresse : non", () => {
    expect(checkOrderable(order({ orderPaymentStatus: "PENDING" }))).toEqual({ ok: false, code: "NOT_PAID" });
    expect(checkOrderable(order({ cancelStatus: { cancelState: "CANCEL_REQUESTED" } }))).toEqual({ ok: false, code: "CANCELLED_BY_BUYER" });
    expect(checkOrderable(order({ orderFulfillmentStatus: "FULFILLED" }))).toEqual({ ok: false, code: "ALREADY_SHIPPED" });
    expect(checkOrderable(order({ fulfillmentStartInstructions: [] }))).toEqual({ ok: false, code: "NO_ADDRESS" });
  });
  it("relie les lignes à nos annonces CJ, signale les autres", () => {
    const o = order({ lineItems: [{ lineItemId: "L1", sku: "PL-A", quantity: 2, title: "Can opener" }, { lineItemId: "L2", sku: "OTHER", quantity: 1, title: "Old stock" }] });
    const r = mapLines(o, new Map([["PL-A", { id: "LST", supplierVariantId: "V1", supplierProductId: "P1", supplier: "CJ" }]]));
    expect(r.lines).toEqual([{ lineItemId: "L1", sku: "PL-A", quantity: 2, listingId: "LST", supplier: "CJ", productId: "P1", vid: "V1", title: "Can opener" }]);
    expect(r.unknown).toEqual(["Old stock"]);
  });
});

describe("commandes : fournisseur", () => {
  it("adresse pour le fournisseur (téléphone nettoyé, région remplacée par la ville si absente)", () => {
    const to = order().fulfillmentStartInstructions[0].shippingStep!.shipTo;
    expect(shipAddress(to)).toMatchObject({ fullName: "Jane Doe", address: "1 Main St", city: "Austin", province: "TX", zip: "73301", phone: "5551234567", country: "US" });
    expect(shipAddress({ ...to, contactAddress: { addressLine1: "Str 1", city: "Berlin", postalCode: "10115", countryCode: "DE" } }).province).toBe("Berlin");
  });
  it("numéro de commande unique ≤ 50 caractères", () => {
    expect(supplierOrderNumber("12-34567-89012")).toBe("EB-12-34567-89012");
    expect(supplierOrderNumber("x".repeat(80)).length).toBe(50);
  });
  it("profit après frais eBay", () => {
    // 30,75 − 11,45 − (30,75 × 13,6 % + 0,40 = 4,58) = 14,72
    expect(orderProfit(30.75, 11.45, "EBAY_US")).toEqual({ fees: 4.58, profit: 14.72 });
  });
  it("erreurs CJ reconnues", () => {
    expect(isBalanceError("Insufficient balance")).toBe(true);
    expect(isDuplicateError("orderNumber already exists")).toBe(true);
    expect(isBalanceError("Address invalid")).toBe(false);
  });
});

describe("commandes : transporteur pour eBay", () => {
  it("par nom de transporteur", () => {
    expect(ebayCarrierCode("USPS Ground Advantage", "X")).toBe("USPS");
    expect(ebayCarrierCode("CJPacket UPS", "X")).toBe("UPS");
    expect(ebayCarrierCode("Royal Mail Tracked 48", "X")).toBe("RoyalMail");
    expect(ebayCarrierCode("DHL Paket", "X")).toBe("DHL");
    expect(ebayCarrierCode("Colissimo", "X")).toBe("Colissimo");
  });
  it("par format du numéro, sinon « Other »", () => {
    expect(ebayCarrierCode("CJPacket Ordinary", "1Z999AA10123456784")).toBe("UPS");
    expect(ebayCarrierCode("CJPacket US", "9400111899223345678901")).toBe("USPS");
    expect(ebayCarrierCode("CJPacket US", "CJ123456789")).toBe("Other");
    expect(ebayCarrierCode(undefined, "ABC")).toBe("Other");
  });
});
