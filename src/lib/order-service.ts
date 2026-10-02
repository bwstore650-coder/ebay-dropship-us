/**
 * Commandes automatiques : vente eBay → commande chez le fournisseur (CJ ou AliExpress) → numéro de suivi renvoyé à eBay.
 * Garde-fous : jamais de double commande (verrou + numéro unique chez le fournisseur), jamais de commande à perte
 * sans l'accord du vendeur, adresse de l'acheteur relue chez eBay au moment de commander (non stockée).
 */
import type { Prisma, User } from "@prisma/client";
import { db } from "@/lib/db";
import * as ebay from "@/lib/ebay";
import { EbayApiError } from "@/lib/ebay";
import { EbayReconnectRequired, userToken } from "@/lib/ebay-account";
import { getUsdRates, offersToCurrency } from "@/lib/fx";
import { landedCost, type SupplierOffer } from "@/lib/margin";
import { marketplace } from "@/lib/marketplaces";
import { planInfo } from "@/lib/plans";
import { ordersAttentionEmail, sendEmail } from "@/lib/email";
import { MAX_MESSAGE_FAILURES, nextMessage, renderMessage } from "@/lib/messages";
import { syncAfterSales } from "@/lib/aftersale-service";
import { openSession, placeSupplierOrder, quote, supplierOrderState, SupplierError, type Session, type SupplierId } from "@/lib/suppliers";
import {
  checkOrderable, shipAddress, ebayCarrierCode, isBalanceError, isDuplicateError, mapLines, orderProfit, shipTo,
  STUCK_AFTER_MS, supplierOrderNumber, type OrderLine,
} from "@/lib/orders";

type Account = { id: string; accessToken: string; accessTokenExpires: Date; refreshToken: string; refreshTokenExpires: Date; ebayUserId?: string | null; label?: string | null };
type UserWithAccounts = User & {
  ebayAccounts: Account[];
  supplierAccounts: { id?: string; supplier: string; accessToken: string; refreshToken?: string | null; expiresAt?: Date | null }[];
};

const LOOKBACK_DAYS = 30;

/** 1. Récupère les nouvelles ventes eBay et les enregistre (sans rien commander). */
export async function importOrders(user: UserWithAccounts, account: Account): Promise<number> {
  const token = await userToken(account);
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
  const orders = await ebay.getOrdersToShip(token, since);
  if (!orders.length) return 0;

  const skus = [...new Set(orders.flatMap((o) => o.lineItems.map((l) => l.sku).filter((s): s is string => Boolean(s))))];
  const itemIds = [...new Set(orders.flatMap((o) => o.lineItems.map((l) => l.legacyItemId).filter((s): s is string => Boolean(s))))];
  const listings = await db.listing.findMany({
    where: { userId: user.id, OR: [{ sku: { in: skus } }, { legacy: true, ebayListingId: { in: itemIds }, status: { in: ["ACTIVE", "PAUSED"] } }] },
    select: { id: true, sku: true, supplierVariantId: true, supplierProductId: true, supplier: true, marketplace: true, currency: true, legacy: true, ebayListingId: true },
  });
  // Annonces à variantes : chaque taille / couleur a son propre SKU, rattaché à l'annonce.
  const variants = await db.listingVariant.findMany({
    where: { sku: { in: skus }, listing: { userId: user.id } },
    include: { listing: { select: { id: true, supplierProductId: true, supplier: true, marketplace: true, currency: true, legacy: true, ebayListingId: true } } },
  });
  for (const v of variants) {
    listings.push({ ...v.listing, sku: v.sku, supplierVariantId: v.supplierVariantId });
  }
  const bySku = new Map(listings.filter((l) => skus.includes(l.sku)).map((l) => [l.sku, l]));
  const byItemId = new Map(listings.filter((l) => l.legacy && l.ebayListingId).map((l) => [l.ebayListingId!, l]));
  const known = await db.order.findMany({ where: { ebayOrderId: { in: orders.map((o) => o.orderId) } }, select: { ebayOrderId: true, status: true, id: true } });
  const knownIds = new Map(known.map((k) => [k.ebayOrderId, k]));

  let created = 0;
  for (const o of orders) {
    const existing = knownIds.get(o.orderId);
    const check = checkOrderable(o);
    if (existing) {
      // Annulée par l'acheteur avant qu'on commande : on ne commandera pas.
      if (!check.ok && check.code === "CANCELLED_BY_BUYER" && (existing.status === "PENDING" || existing.status === "NEEDS_REVIEW"))
        await db.order.update({ where: { id: existing.id }, data: { status: "CANCELLED", errorCode: "CANCELLED_BY_BUYER" } });
      continue;
    }
    const { lines, unknown } = mapLines(o, bySku, byItemId);
    if (!lines.length) continue; // vente d'une annonce qui ne vient pas de l'outil : on n'y touche pas
    const first = listings.find((l) => l.id === lines[0].listingId)!;
    const partial = unknown.length > 0;
    await db.order.create({
      data: {
        userId: user.id,
        ebayAccountId: account.id,
        listingId: first.id,
        ebayOrderId: o.orderId,
        ebayCreatedAt: new Date(o.creationDate),
        buyerUsername: o.buyer?.username ?? null,
        buyerName: shipTo(o)?.fullName?.trim().split(/\s+/)[0]?.slice(0, 40) ?? null,
        marketplace: first.marketplace,
        currency: o.pricingSummary.total.currency ?? first.currency,
        saleTotal: Number(o.pricingSummary.total.value),
        lines: lines as unknown as Prisma.InputJsonValue,
        status: partial ? "NEEDS_REVIEW" : check.ok ? "PENDING" : check.code === "CANCELLED_BY_BUYER" ? "CANCELLED" : "NEEDS_REVIEW",
        errorCode: partial ? "NOT_OURS" : check.ok ? null : check.code,
        errorMessage: partial ? unknown.join(", ").slice(0, 1000) : null,
      },
    });
    created++;
  }
  return created;
}

const MAX_ATTEMPTS = 5;

/** Session fournisseur ouverte une seule fois par passage. */
type Sessions = Map<SupplierId, Promise<Session>>;
function sessionFor(user: UserWithAccounts, supplier: SupplierId, sessions: Sessions): Promise<Session> {
  if (!sessions.has(supplier)) sessions.set(supplier, openSession(user.supplierAccounts, supplier));
  return sessions.get(supplier)!;
}

/** Lignes enregistrées avant la prise en charge d'AliExpress : fournisseur CJ et produit relu sur l'annonce. */
async function normalizeLines(lines: OrderLine[]): Promise<OrderLine[]> {
  const missing = lines.filter((l) => !l.productId || !l.supplier);
  if (!missing.length) return lines;
  const listings = await db.listing.findMany({ where: { id: { in: missing.map((l) => l.listingId) } }, select: { id: true, supplierProductId: true, supplier: true } });
  const byId = new Map(listings.map((l) => [l.id, l]));
  return lines.map((l) => ({
    ...l,
    supplier: l.supplier ?? (byId.get(l.listingId)?.supplier as SupplierId | undefined) ?? "CJ",
    productId: l.productId ?? byId.get(l.listingId)?.supplierProductId ?? "",
  }));
}

/**
 * 2. Passe la commande chez le fournisseur (CJ : payée avec le solde CJ ; AliExpress : paiement automatique
 * avec le moyen enregistré sur le compte AliExpress, sinon à payer dans AliExpress).
 * `force` : le vendeur a confirmé à la main (commande à perte, nouvel essai après un échec).
 */
export async function placeOrder(user: UserWithAccounts, orderId: string, opts: { force?: boolean } = {}): Promise<string> {
  const allowed = opts.force ? (["PENDING", "NEEDS_REVIEW", "FAILED"] as const) : (["PENDING"] as const);
  // Verrou : une seule exécution peut faire passer la commande en « ORDERING ».
  const claimed = await db.order.updateMany({
    where: { id: orderId, userId: user.id, status: { in: [...allowed] } },
    data: { status: "ORDERING", attempts: { increment: 1 }, errorCode: null, errorMessage: null },
  });
  if (claimed.count !== 1) return "SKIPPED";
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  const fail = async (status: "NEEDS_REVIEW" | "FAILED" | "CANCELLED", code: string, message?: string) => {
    await db.order.update({ where: { id: orderId }, data: { status, errorCode: code, errorMessage: message?.slice(0, 1000) ?? null } });
    return code;
  };

  try {
    const lines = await normalizeLines(order.lines as unknown as OrderLine[]);
    const supplier = lines[0]?.supplier ?? "CJ";
    if (lines.some((l) => l.supplier !== supplier)) return await fail("NEEDS_REVIEW", "MIXED_SUPPLIERS");
    let session: Session;
    try {
      session = await openSession(user.supplierAccounts, supplier);
    } catch (e) {
      if (e instanceof SupplierError) return await fail("NEEDS_REVIEW", e.code === "SUPPLIER_RECONNECT" ? "SUPPLIER_RECONNECT" : "NO_SUPPLIER");
      throw e;
    }
    const account = user.ebayAccounts.find((a) => a.id === order.ebayAccountId);
    if (!account) return await fail("NEEDS_REVIEW", "EBAY_RECONNECT");

    // Quota mensuel de la formule.
    const monthly = planInfo(user.plan)?.autoOrdersPerMonth ?? null;
    if (user.plan === "NONE") return await fail("NEEDS_REVIEW", "PLAN_REQUIRED");
    if (monthly !== null) {
      const now = new Date();
      const done = await db.order.count({
        where: { userId: user.id, orderedAt: { gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) } },
      });
      if (done >= monthly) return await fail("NEEDS_REVIEW", "PLAN_LIMIT_ORDERS", String(monthly));
    }

    // Commande eBay relue maintenant : payée, non annulée, adresse à jour.
    const eToken = await userToken(account);
    const eo = await ebay.getOrder(eToken, order.ebayOrderId);
    const check = checkOrderable(eo);
    if (!check.ok) return await fail(check.code === "CANCELLED_BY_BUYER" || check.code === "ALREADY_SHIPPED" ? "CANCELLED" : "NEEDS_REVIEW", check.code);
    const address = shipAddress(shipTo(eo)!);
    const country = address.country;

    // Coût actuel, stock et transporteur chez le fournisseur.
    const usd: SupplierOffer[] = [];
    let service = "";
    for (const l of lines) {
      const q = await quote(session, l.productId, l.vid, l.quantity, country);
      if (q.kind !== "ok") return await fail("NEEDS_REVIEW", "OUT_OF_STOCK", l.title);
      service ||= q.service;
      usd.push({
        supplier, productId: l.productId, variantId: l.vid, title: l.title,
        price: q.unitPrice * l.quantity, shipping: q.shipping, taxRate: q.taxRate, stockUs: q.stock, deliveryDaysMax: q.deliveryDaysMax,
      });
    }
    const offers = order.currency === "USD" ? usd : offersToCurrency(usd, order.currency, await getUsdRates());
    const cost = Math.round(offers.reduce((s, o) => s + landedCost({ supplierCost: o.price, supplierShipping: o.shipping, supplierTaxRate: o.taxRate }), 0) * 100) / 100;
    const promoted = order.listingId ? await db.listing.findUnique({ where: { id: order.listingId }, select: { adRate: true } }).catch(() => null) : null;
    const { fees, profit } = orderProfit(order.saleTotal, cost, order.marketplace, promoted?.adRate);
    if (profit < 0 && !opts.force) {
      await db.order.update({ where: { id: orderId }, data: { supplierCost: cost, fees, profit } });
      return await fail("NEEDS_REVIEW", "LOSS", `${profit.toFixed(2)} ${order.currency}`);
    }

    // Commande chez le fournisseur. Le numéro EB-<commande eBay> est unique : pas de double commande.
    let created: { orderId: string };
    try {
      created = await placeSupplierOrder(session, {
        orderNumber: supplierOrderNumber(order.ebayOrderId),
        address,
        service,
        lines: lines.map((l) => ({ productId: l.productId, variantId: l.vid, quantity: l.quantity })),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isDuplicateError(msg)) return await fail("NEEDS_REVIEW", "DUPLICATE", msg);
      if (supplier === "CJ" && isBalanceError(msg)) return await fail("FAILED", "CJ_BALANCE", msg);
      return await fail("FAILED", supplier === "CJ" ? "CJ_ERROR" : "AE_ERROR", msg);
    }
    await db.order.update({
      where: { id: orderId },
      data: { status: "ORDERED", supplierOrderId: created.orderId, supplierCost: cost, fees, profit, orderedAt: new Date() },
    });
    return "ORDERED";
  } catch (e) {
    console.error("Commande auto", order.ebayOrderId, e);
    if (e instanceof EbayReconnectRequired || (e instanceof EbayApiError && e.status === 401)) return await fail("NEEDS_REVIEW", "EBAY_RECONNECT");
    // Erreur avant l'envoi au fournisseur : on réessaiera au prochain passage (5 essais au maximum).
    if (order.attempts >= MAX_ATTEMPTS) return await fail("NEEDS_REVIEW", "RETRY_LIMIT", e instanceof Error ? e.message : String(e));
    await db.order.update({ where: { id: orderId }, data: { status: "PENDING", errorCode: "RETRY", errorMessage: (e instanceof Error ? e.message : String(e)).slice(0, 1000) } });
    return "RETRY";
  }
}

/** 3. Numéros de suivi : lus chez le fournisseur, renvoyés à eBay. */
export async function syncTracking(user: UserWithAccounts): Promise<number> {
  const orders = await db.order.findMany({ where: { userId: user.id, status: "ORDERED", supplierOrderId: { not: null } }, take: 50, orderBy: { orderedAt: "asc" } });
  const sessions: Sessions = new Map();
  let shipped = 0;
  for (const o of orders) {
    try {
      const lines = await normalizeLines(o.lines as unknown as OrderLine[]);
      const supplier = lines[0]?.supplier ?? "CJ";
      const state = await supplierOrderState(await sessionFor(user, supplier, sessions), o.supplierOrderId!);
      if (state.state === "CANCELLED") {
        await db.order.update({ where: { id: o.id }, data: { status: "FAILED", errorCode: supplier === "CJ" ? "CJ_CANCELLED" : "AE_CANCELLED" } });
        continue;
      }
      if (state.state === "UNPAID") {
        // AliExpress sans paiement automatique : on le signale une fois au vendeur.
        if (o.errorCode !== "AE_UNPAID") await db.order.update({ where: { id: o.id }, data: { errorCode: "AE_UNPAID" } });
        continue;
      }
      if (state.state !== "SHIPPED") {
        if (o.errorCode === "AE_UNPAID") await db.order.update({ where: { id: o.id }, data: { errorCode: null } });
        continue;
      }
      const account = user.ebayAccounts.find((a) => a.id === o.ebayAccountId);
      if (!account) continue;
      const carrier = ebayCarrierCode(state.carrierName, state.trackingNumber);
      try {
        await ebay.addTracking(await userToken(account), o.ebayOrderId, lines.map((l) => ({ lineItemId: l.lineItemId, quantity: l.quantity })), carrier, state.trackingNumber);
      } catch (e) {
        await db.order.update({
          where: { id: o.id },
          data: { trackingNumber: state.trackingNumber, carrier, errorCode: "EBAY_TRACKING", errorMessage: (e instanceof EbayApiError ? e.readable : String(e)).slice(0, 1000) },
        });
        continue;
      }
      await db.order.update({
        where: { id: o.id },
        data: { status: "SHIPPED", trackingNumber: state.trackingNumber, carrier, shippedAt: new Date(), errorCode: null, errorMessage: null },
      });
      shipped++;
    } catch (e) {
      console.error("Suivi", o.ebayOrderId, e);
    }
  }
  return shipped;
}

/** Commandes bloquées « en cours » (panne pendant l'envoi) : à vérifier à la main, jamais recommandées automatiquement. */
async function releaseStuck(userId: string) {
  await db.order.updateMany({
    where: { userId, status: "ORDERING", updatedAt: { lt: new Date(Date.now() - STUCK_AFTER_MS) } },
    data: { status: "NEEDS_REVIEW", errorCode: "STUCK" },
  });
}

export interface RunReport { imported: number; ordered: number; review: number; shipped: number; messages: number; errors: string[] }

/** Cycle complet pour un vendeur. */
export async function runForUser(user: UserWithAccounts): Promise<RunReport> {
  const report: RunReport = { imported: 0, ordered: 0, review: 0, shipped: 0, messages: 0, errors: [] };
  if (user.plan === "NONE") return report;
  await releaseStuck(user.id);
  for (const account of user.ebayAccounts) {
    try {
      report.imported += await importOrders(user, account);
    } catch (e) {
      report.errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (user.autoOrder) {
    const pending = await db.order.findMany({ where: { userId: user.id, status: "PENDING" }, select: { id: true }, orderBy: { createdAt: "asc" }, take: 25 });
    for (const p of pending) {
      const r = await placeOrder(user, p.id);
      if (r === "ORDERED") report.ordered++;
      else if (r !== "RETRY" && r !== "SKIPPED") report.review++;
    }
  }
  report.shipped = await syncTracking(user);
  report.messages = await sendMessages(user);
  // Retours et annulations : relevés au plus une fois par heure.
  if (!user.afterSalesSyncedAt || Date.now() - user.afterSalesSyncedAt.getTime() > 55 * 60_000) {
    try {
      await syncAfterSales(user);
      await db.user.update({ where: { id: user.id }, data: { afterSalesSyncedAt: new Date() } });
    } catch (e) {
      report.errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  await notifyAttention(user);
  return report;
}

const MESSAGES_PER_RUN = 20;

/** Messages automatiques aux acheteurs (remerciement, suivi, demande d'évaluation), selon les réglages du vendeur. */
export async function sendMessages(user: UserWithAccounts, now = Date.now()): Promise<number> {
  if (!user.msgThanks && !user.msgShipped && !user.msgFeedback) return 0;
  const orders = await db.order.findMany({
    where: {
      userId: user.id,
      buyerUsername: { not: null },
      msgFailures: { lt: MAX_MESSAGE_FAILURES },
      status: { in: ["PENDING", "ORDERING", "ORDERED", "SHIPPED", "NEEDS_REVIEW"] },
      createdAt: { gte: new Date(now - 60 * 86_400_000) },
      OR: [{ msgThanksAt: null }, { msgShippedAt: null }, { msgFeedbackAt: null }],
    },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  const tokens = new Map<string, Promise<string>>();
  let sent = 0;
  for (const o of orders) {
    if (sent >= MESSAGES_PER_RUN) break;
    const kind = nextMessage(o, user, now);
    if (!kind) continue;
    const account = user.ebayAccounts.find((a) => a.id === o.ebayAccountId);
    const line = ((o.lines as unknown as OrderLine[]) ?? []).find((l) => l.legacyItemId);
    if (!account || !line?.legacyItemId) continue;
    const field = kind === "THANKS" ? "msgThanksAt" : kind === "SHIPPED" ? "msgShippedAt" : "msgFeedbackAt";
    try {
      if (!tokens.has(account.id)) tokens.set(account.id, userToken(account));
      const msg = renderMessage(kind, o.marketplace, {
        name: o.buyerName, item: line.title, store: account.ebayUserId ?? account.label ?? "", tracking: o.trackingNumber, carrier: o.carrier,
      });
      await ebay.sendBuyerMessage(await tokens.get(account.id)!, { itemId: line.legacyItemId, buyer: o.buyerUsername!, ...msg }, marketplace(o.marketplace).id);
      await db.order.update({ where: { id: o.id }, data: { [field]: new Date(now) } });
      sent++;
    } catch (e) {
      console.error("Message acheteur", o.ebayOrderId, kind, e);
      await db.order.update({ where: { id: o.id }, data: { msgFailures: { increment: 1 } } });
    }
  }
  return sent;
}

/** Email « commandes à vérifier » : seulement s'il y a du nouveau, et au plus une fois toutes les 6 heures. */
const ATTENTION_EVERY_MS = 6 * 3600_000;
async function notifyAttention(user: UserWithAccounts) {
  const last = user.lastAttentionEmailAt;
  if (last && Date.now() - last.getTime() < ATTENTION_EVERY_MS) return;
  const fresh = await db.order.count({
    where: { userId: user.id, status: { in: ["NEEDS_REVIEW", "FAILED"] }, ...(last ? { updatedAt: { gt: last } } : {}) },
  });
  if (!fresh) return;
  const total = await db.order.count({ where: { userId: user.id, status: { in: ["NEEDS_REVIEW", "FAILED"] } } });
  await db.user.update({ where: { id: user.id }, data: { lastAttentionEmailAt: new Date() } });
  await sendEmail(ordersAttentionEmail(user.email, user.locale, total));
}

/** Tous les vendeurs actifs (tâche planifiée), dans la limite de temps donnée. */
export async function runAll(deadline: number): Promise<{ users: number; reports: RunReport[] }> {
  const users = await db.user.findMany({
    where: { plan: { not: "NONE" }, ebayAccounts: { some: {} } },
    include: { ebayAccounts: { orderBy: { createdAt: "asc" } }, supplierAccounts: true },
  });
  const reports: RunReport[] = [];
  for (const u of users) {
    if (Date.now() > deadline) break;
    try {
      reports.push(await runForUser(u));
    } catch (e) {
      console.error("Commandes auto", u.id, e);
    }
  }
  return { users: users.length, reports };
}
