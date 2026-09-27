/**
 * Surveillance du stock et des prix (fonction pure, testée) : que faire d'une annonce
 * après avoir relu le stock et le coût chez le fournisseur.
 */
import { computeMargin, MAX_DELIVERY_DAYS, priceForTargetMargin } from "@/lib/margin";
import { marketplace } from "@/lib/marketplaces";
import { DEFAULT_QUANTITY } from "@/lib/listing";

export type PauseReason = "OUT_OF_STOCK" | "MARGIN" | "SLOW" | "SUPPLIER_GONE";

export interface MonitorInput {
  status: "ACTIVE" | "PAUSED";
  price: number;                // prix de l'annonce (devise du pays)
  quantity: number;             // quantité affichée quand l'annonce est active
  marketId: string;
  minMarginPct: number;
  supplier:
    | { found: false }
    | { found: true; stock: number; cost: number | null; deliveryDaysMax: number }; // cost = coût livré, null si aucune livraison possible
}

export type MonitorDecision =
  | { action: "KEEP"; marginPct: number; cost: number }
  | { action: "SET_QUANTITY"; quantity: number; marginPct: number; cost: number }
  | { action: "PAUSE"; reason: PauseReason; detail?: string; marginPct?: number; cost?: number }
  | { action: "RESUME"; quantity: number; marginPct: number; cost: number };

/** Quantité à afficher : faible (anti-survente) et jamais plus que le stock du fournisseur. */
export const visibleQuantity = (stock: number) => Math.max(0, Math.min(DEFAULT_QUANTITY, stock));

export function decide(i: MonitorInput): MonitorDecision {
  const s = i.supplier;
  if (!s.found) return { action: "PAUSE", reason: "SUPPLIER_GONE" };
  if (s.stock < 1) return { action: "PAUSE", reason: "OUT_OF_STOCK" };
  if (s.cost === null || s.deliveryDaysMax > MAX_DELIVERY_DAYS) return { action: "PAUSE", reason: "SLOW" };

  const m = marketplace(i.marketId);
  const margin = computeMargin({ saleTotal: i.price, supplierCost: s.cost, market: m });
  if (margin.marginPct < i.minMarginPct) {
    const min = priceForTargetMargin(s.cost, i.minMarginPct, { market: m });
    return { action: "PAUSE", reason: "MARGIN", detail: min.toFixed(2), marginPct: margin.marginPct, cost: s.cost };
  }

  const qty = visibleQuantity(s.stock);
  if (i.status === "PAUSED") return { action: "RESUME", quantity: qty, marginPct: margin.marginPct, cost: s.cost };
  if (qty !== i.quantity) return { action: "SET_QUANTITY", quantity: qty, marginPct: margin.marginPct, cost: s.cost };
  return { action: "KEEP", marginPct: margin.marginPct, cost: s.cost };
}

/** Une annonce est revérifiée toutes les heures au plus. */
export const CHECK_EVERY_MS = 60 * 60_000;
