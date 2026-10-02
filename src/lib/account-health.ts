/**
 * Protection du compte eBay : limites de vente, standards vendeur (défauts, retards), commandes à risque.
 * Les fonctions pures (riskyOrders, limitUsage, healthAlerts) sont testées ; accountHealth lit eBay et la base.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import * as ebay from "@/lib/ebay";
import { userToken } from "@/lib/ebay-account";
import { readState, writeState } from "@/lib/ebay-quota";
import { marketplace, type MarketplaceId } from "@/lib/marketplaces";

const HOUR = 3_600_000;
/** Données eBay gardées 6 h (contrat API : 24 h maximum). */
const CACHE_MS = 6 * HOUR;
/** Une vente doit être commandée chez le fournisseur dans les 12 h, sinon l'expédition risque d'être en retard. */
export const ORDER_LATE_AFTER_H = 12;
/** Commandée depuis 3 jours sans numéro de suivi : retard d'expédition probable chez eBay. */
export const TRACKING_LATE_AFTER_H = 72;
/** Alerte à partir de 80 % de la limite de vente. */
export const LIMIT_WARN = 0.8;

export interface RiskOrder { id: string; ebayOrderId: string; status: string; hours: number; reason: "NOT_ORDERED" | "NO_TRACKING" }

/** Ventes qui risquent un retard d'expédition (donc un défaut sur le compte). */
export function riskyOrders(
  orders: { id: string; ebayOrderId: string; status: string; createdAt: Date; orderedAt: Date | null; trackingNumber: string | null }[],
  now = Date.now(),
): RiskOrder[] {
  const out: RiskOrder[] = [];
  for (const o of orders) {
    const age = (now - o.createdAt.getTime()) / HOUR;
    if (["PENDING", "NEEDS_REVIEW", "FAILED", "ORDERING"].includes(o.status) && age >= ORDER_LATE_AFTER_H) {
      out.push({ id: o.id, ebayOrderId: o.ebayOrderId, status: o.status, hours: Math.floor(age), reason: "NOT_ORDERED" });
    } else if (o.status === "ORDERED" && !o.trackingNumber && o.orderedAt && (now - o.orderedAt.getTime()) / HOUR >= TRACKING_LATE_AFTER_H) {
      out.push({ id: o.id, ebayOrderId: o.ebayOrderId, status: o.status, hours: Math.floor((now - o.orderedAt.getTime()) / HOUR), reason: "NO_TRACKING" });
    }
  }
  return out.sort((a, b) => b.hours - a.hours);
}

export interface LimitUsage { quantity: { used: number; limit: number; share: number } | null; amount: { used: number; limit: number; share: number; currency: string | null } | null }

/** Part de la limite de vente utilisée par les annonces en ligne (gérées par Sellvela + créées sur eBay). */
export function limitUsage(limit: ebay.SellingLimit | null, listings: { price: number; quantity: number }[]): LimitUsage {
  const qty = listings.reduce((s, l) => s + Math.max(0, l.quantity), 0);
  const value = Math.round(listings.reduce((s, l) => s + Math.max(0, l.quantity) * Math.max(0, l.price), 0) * 100) / 100;
  const share = (u: number, l: number) => (l > 0 ? Math.round((u / l) * 1000) / 1000 : 0);
  return {
    quantity: limit?.quantity ? { used: qty, limit: limit.quantity, share: share(qty, limit.quantity) } : null,
    amount: limit?.amount ? { used: value, limit: limit.amount, share: share(value, limit.amount), currency: limit.currency } : null,
  };
}

export type Alert =
  | { kind: "BELOW_STANDARD" }
  | { kind: "LIMIT"; share: number }
  | { kind: "NOT_ORDERED"; n: number }
  | { kind: "NO_TRACKING"; n: number }
  | { kind: "RECONNECT" };

/** Points à surveiller, du plus grave au moins grave. */
export function healthAlerts(h: { standards: ebay.SellerStandards | null; usage: LimitUsage | null; risks: RiskOrder[]; needsReconnect: boolean }): Alert[] {
  const out: Alert[] = [];
  if (h.standards?.level === "BELOW_STANDARD") out.push({ kind: "BELOW_STANDARD" });
  const notOrdered = h.risks.filter((r) => r.reason === "NOT_ORDERED").length;
  if (notOrdered) out.push({ kind: "NOT_ORDERED", n: notOrdered });
  const noTracking = h.risks.filter((r) => r.reason === "NO_TRACKING").length;
  if (noTracking) out.push({ kind: "NO_TRACKING", n: noTracking });
  const share = Math.max(h.usage?.quantity?.share ?? 0, h.usage?.amount?.share ?? 0);
  if (share >= LIMIT_WARN) out.push({ kind: "LIMIT", share });
  if (h.needsReconnect) out.push({ kind: "RECONNECT" });
  return out;
}

export interface AccountHealth {
  accountId: string;
  marketId: MarketplaceId;
  standards: ebay.SellerStandards | null;
  standardsError: boolean;
  needsReconnect: boolean; // compte connecté avant l'ajout de la lecture des standards
  limit: ebay.SellingLimit | null;
  usage: LimitUsage | null;
  risks: RiskOrder[];
  alerts: Alert[];
  activeListings: number;
  checkedAt: string;
}

type Account = Parameters<typeof userToken>[0] & { id: string; scopes?: string | null };

/** Santé d'un compte eBay (données eBay en cache 6 h ; `fresh` force la relecture). */
export async function accountHealth(userId: string, account: Account, marketId: MarketplaceId, fresh = false): Promise<AccountHealth> {
  const m = marketplace(marketId);
  const key = `health:${account.id}:${m.id}`;
  type Cached = { standards: ebay.SellerStandards | null; standardsError: boolean; limit: ebay.SellingLimit | null; checkedAt: string };
  let cached = fresh ? null : await readState<Cached>(key);
  const needsReconnect = !ebay.canReadStandards(account.scopes);
  if (!cached) {
    const token = await userToken(account);
    const [limit, standards] = await Promise.all([
      ebay.getSellingLimit(token).catch((e) => {
        console.error("Limites de vente", e);
        return null;
      }),
      needsReconnect
        ? Promise.resolve(undefined)
        : ebay.getSellerStandards(token, m.id).catch((e) => {
            console.error("Standards vendeur", e);
            return undefined;
          }),
    ]);
    cached = { limit, standards: standards ?? null, standardsError: !needsReconnect && standards === undefined, checkedAt: new Date().toISOString() };
    await writeState(key, cached as unknown as Prisma.InputJsonValue, new Date(Date.now() + CACHE_MS));
  }

  const [listings, external, orders] = await Promise.all([
    db.listing.findMany({ where: { userId, ebayAccountId: account.id, status: "ACTIVE", legacy: false }, select: { price: true, quantity: true } }),
    db.externalListing.findMany({ where: { userId, ebayAccountId: account.id }, select: { price: true, quantity: true } }),
    db.order.findMany({
      where: { userId, ebayAccountId: account.id, status: { in: ["PENDING", "NEEDS_REVIEW", "FAILED", "ORDERING", "ORDERED"] }, createdAt: { gte: new Date(Date.now() - 30 * 24 * HOUR) } },
      select: { id: true, ebayOrderId: true, status: true, createdAt: true, orderedAt: true, trackingNumber: true },
      take: 500,
    }),
  ]);
  const all = [...listings, ...external.map((e) => ({ price: e.price, quantity: e.quantity }))];
  const usage = limitUsage(cached.limit, all);
  const risks = riskyOrders(orders);
  return {
    accountId: account.id,
    marketId: m.id,
    standards: cached.standards,
    standardsError: cached.standardsError,
    needsReconnect,
    limit: cached.limit,
    usage,
    risks,
    alerts: healthAlerts({ standards: cached.standards, usage, risks, needsReconnect }),
    activeListings: all.length,
    checkedAt: cached.checkedAt,
  };
}
