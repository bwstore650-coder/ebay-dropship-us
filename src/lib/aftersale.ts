/**
 * Retours et annulations (fonctions pures, testées) : lecture des données eBay et actions possibles.
 */
import type { EbayCancellation, EbayReturn } from "@/lib/ebay";

export interface AfterSaleRow {
  type: "RETURN" | "CANCEL";
  ebayId: string;
  ebayOrderId: string;
  state: string;
  open: boolean;
  reason: string | null;
  buyerComment: string | null;
  amount: number | null;
  currency: string | null;
  itemTitle: string | null;
  requestedAt: Date | null;
}

const num = (v: unknown) => (v === undefined || v === null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const date = (v: string | undefined) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v) : null);

/** Annulation encore à traiter par le vendeur. */
export const CANCEL_OPEN_STATES = ["CANCEL_REQUESTED", "CANCEL_PENDING"];

export function returnToRow(r: EbayReturn): AfterSaleRow {
  return {
    type: "RETURN",
    ebayId: r.returnId,
    ebayOrderId: r.orderId,
    state: r.state,
    open: !/CLOSED/.test(r.state),
    reason: r.creationInfo?.reason ?? null,
    buyerComment: r.creationInfo?.comments?.content?.slice(0, 1000) ?? null,
    amount: num(r.buyerTotalRefund?.estimatedRefundAmount?.value),
    currency: r.buyerTotalRefund?.estimatedRefundAmount?.currency ?? null,
    itemTitle: r.creationInfo?.item?.itemTitle?.slice(0, 300) ?? null,
    requestedAt: date(r.creationInfo?.creationDate?.value),
  };
}

export function cancelToRow(c: EbayCancellation): AfterSaleRow {
  return {
    type: "CANCEL",
    ebayId: c.cancelId,
    ebayOrderId: c.legacyOrderId,
    state: c.cancelState,
    open: CANCEL_OPEN_STATES.includes(c.cancelState),
    reason: c.cancelReason ?? null,
    buyerComment: null,
    amount: num(c.requestRefundAmount?.value),
    currency: c.requestRefundAmount?.currency ?? null,
    itemTitle: null,
    requestedAt: date(c.cancelRequestDate?.value),
  };
}

/** Actions proposées au vendeur pour un dossier. */
export function actionsFor(
  a: { type: "RETURN" | "CANCEL"; state: string; open: boolean; action: string | null },
  order: { status: string; supplierOrderId: string | null } | null,
): { approveCancel: boolean; acceptReturn: boolean; cancelSupplier: boolean } {
  return {
    approveCancel: a.open && a.type === "CANCEL" && a.state === "CANCEL_REQUESTED" && a.action !== "APPROVED",
    acceptReturn: a.open && a.type === "RETURN" && a.state === "RETURN_REQUESTED" && a.action !== "ACCEPTED",
    // Commande fournisseur passée mais pas encore expédiée : on peut essayer de l'annuler aussi.
    cancelSupplier: a.type === "CANCEL" && a.action !== "SUPPLIER_CANCELLED" && Boolean(order?.supplierOrderId) && order?.status === "ORDERED",
  };
}
