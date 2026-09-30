import { describe, expect, it } from "vitest";
import { actionsFor, cancelToRow, returnToRow } from "./aftersale";

describe("retours et annulations", () => {
  it("lit un retour eBay", () => {
    const r = returnToRow({
      returnId: "5000123", orderId: "12-11111-22222", state: "RETURN_REQUESTED",
      creationInfo: { reason: "NOT_AS_DESCRIBED", comments: { content: "Broken lid" }, creationDate: { value: "2026-09-28T10:00:00.000Z" }, item: { itemId: "1", itemTitle: "Can opener" } },
      buyerTotalRefund: { estimatedRefundAmount: { value: 30.75, currency: "USD" } },
    });
    expect(r).toEqual({
      type: "RETURN", ebayId: "5000123", ebayOrderId: "12-11111-22222", state: "RETURN_REQUESTED", open: true, reason: "NOT_AS_DESCRIBED",
      buyerComment: "Broken lid", amount: 30.75, currency: "USD", itemTitle: "Can opener", requestedAt: new Date("2026-09-28T10:00:00.000Z"),
    });
    expect(returnToRow({ returnId: "1", orderId: "o", state: "CLOSED" }).open).toBe(false);
  });

  it("lit une annulation eBay", () => {
    const c = cancelToRow({ cancelId: "C1", legacyOrderId: "12-1-2", cancelState: "CANCEL_REQUESTED", cancelReason: "BUYER_ASKED_CANCEL", requestRefundAmount: { value: "19.90", currency: "EUR" } });
    expect(c).toMatchObject({ type: "CANCEL", open: true, amount: 19.9, currency: "EUR", reason: "BUYER_ASKED_CANCEL", requestedAt: null });
    expect(cancelToRow({ cancelId: "C2", legacyOrderId: "x", cancelState: "CANCEL_CLOSED" }).open).toBe(false);
  });

  it("actions proposées", () => {
    const cancel = { type: "CANCEL" as const, state: "CANCEL_REQUESTED", open: true, action: null };
    expect(actionsFor(cancel, { status: "ORDERED", supplierOrderId: "CJ1" })).toEqual({ approveCancel: true, acceptReturn: false, cancelSupplier: true });
    expect(actionsFor(cancel, { status: "SHIPPED", supplierOrderId: "CJ1" }).cancelSupplier).toBe(false);
    expect(actionsFor({ ...cancel, action: "APPROVED" }, null)).toEqual({ approveCancel: false, acceptReturn: false, cancelSupplier: false });
    // Commande fournisseur annulée d'abord : l'annulation eBay reste à accepter.
    expect(actionsFor({ ...cancel, action: "SUPPLIER_CANCELLED" }, { status: "CANCELLED", supplierOrderId: "CJ1" })).toEqual({ approveCancel: true, acceptReturn: false, cancelSupplier: false });
    const ret = { type: "RETURN" as const, state: "RETURN_REQUESTED", open: true, action: null };
    expect(actionsFor(ret, null)).toEqual({ approveCancel: false, acceptReturn: true, cancelSupplier: false });
  });
});
