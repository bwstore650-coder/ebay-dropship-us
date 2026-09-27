/**
 * Commandes automatiques : vente eBay → commande payée chez CJ → numéro de suivi renvoyé à eBay.
 * Garde-fous : jamais de double commande (verrou + numéro unique chez CJ), jamais de commande à perte
 * sans l'accord du vendeur, adresse de l'acheteur relue chez eBay au moment de commander (non stockée).
 */
import type { Prisma, User } from "@prisma/client";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import * as ebay from "@/lib/ebay";
import { EbayApiError } from "@/lib/ebay";
import { EbayReconnectRequired, userToken } from "@/lib/ebay-account";
import { getUsdRates, offersToCurrency } from "@/lib/fx";
import { landedCost, type SupplierOffer } from "@/lib/margin";
import { planInfo } from "@/lib/plans";
import * as cj from "@/lib/suppliers/cj";
import {
  checkOrderable, cjAddress, ebayCarrierCode, isBalanceError, isDuplicateError, mapLines, orderProfit, shipTo,
  STUCK_AFTER_MS, supplierOrderNumber, type OrderLine,
} from "@/lib/orders";

type Account = { id: string; accessToken: string; accessTokenExpires: Date; refreshToken: string; refreshTokenExpires: Date };
type UserWithAccounts = User & { ebayAccounts: Account[]; supplierAccounts: { supplier: string; accessToken: string }[] };

const LOOKBACK_DAYS = 30;

function cjToken(user: UserWithAccounts): string | null {
  const acc = user.supplierAccounts.find((a) => a.supplier === "CJ");
  return acc ? decrypt(acc.accessToken) : null;
}

/** 1. Récupère les nouvelles ventes eBay et les enregistre (sans rien commander). */
export async function importOrders(user: UserWithAccounts, account: Account): Promise<number> {
  const token = await userToken(account);
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
  const orders = await ebay.getOrdersToShip(token, since);
  if (!orders.length) return 0;

  const skus = [...new Set(orders.flatMap((o) => o.lineItems.map((l) => l.sku).filter((s): s is string => Boolean(s))))];
  const listings = await db.listing.findMany({
    where: { userId: user.id, sku: { in: skus } },
    select: { id: true, sku: true, supplierVariantId: true, supplier: true, marketplace: true, currency: true },
  });
  const bySku = new Map(listings.map((l) => [l.sku, l]));
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
    const { lines, unknown } = mapLines(o, bySku);
    if (!lines.length) continue; // vente d'une annonce qui ne vient pas de l'outil : on n'y touche pas
    const first = bySku.get(lines[0].sku)!;
    const partial = unknown.length > 0;
    await db.order.create({
      data: {
        userId: user.id,
        ebayAccountId: account.id,
        listingId: first.id,
        ebayOrderId: o.orderId,
        ebayCreatedAt: new Date(o.creationDate),
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

export class OrderSkipped extends Error {}

/** Stock, prix de chaque variante et transporteur le moins cher chez CJ (en USD). */
async function quoteCj(token: string, lines: OrderLine[], productOf: Map<string, string>, country: string) {
  const usd: SupplierOffer[] = [];
  let logisticName = "";
  for (const line of lines) {
    const pid = productOf.get(line.listingId);
    const product = pid ? await cj.getProduct(token, pid) : null;
    const v = product?.variants.find((x) => x.vid === line.vid);
    const stock = v?.inventories?.find((i) => i.countryCode === country)?.totalInventory ?? 0;
    if (!v || stock < line.quantity) return { ok: false as const, code: "OUT_OF_STOCK", detail: line.title };
    const options = await cj.freightCalculate(token, line.vid, line.quantity, country);
    if (!options.length) return { ok: false as const, code: "OUT_OF_STOCK", detail: line.title };
    const cheapest = options.reduce((x, y) => (y.logisticPrice < x.logisticPrice ? y : x));
    logisticName ||= cheapest.logisticName;
    usd.push({
      supplier: "CJ",
      productId: pid!,
      variantId: line.vid,
      title: line.title,
      price: Number(v.variantSellPrice) * line.quantity,
      shipping: Number(cheapest.logisticPrice),
      stockUs: stock,
      deliveryDaysMax: cj.parseMaxDays(cheapest.logisticAging),
    });
  }
  return { ok: true as const, usd, logisticName };
}

const MAX_ATTEMPTS = 5;

/**
 * 2. Passe la commande chez CJ (payée avec le solde CJ du vendeur).
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
    const token = cjToken(user);
    if (!token) return await fail("NEEDS_REVIEW", "NO_SUPPLIER");
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
    const to = shipTo(eo)!;
    const country = to.contactAddress.countryCode;

    // Coût actuel et stock chez CJ.
    const lines = order.lines as unknown as OrderLine[];
    const listings = await db.listing.findMany({ where: { id: { in: lines.map((l) => l.listingId) } }, select: { id: true, supplierProductId: true } });
    const q = await quoteCj(token, lines, new Map(listings.map((l) => [l.id, l.supplierProductId])), country);
    if (!q.ok) return await fail("NEEDS_REVIEW", q.code, q.detail);
    const offers = order.currency === "USD" ? q.usd : offersToCurrency(q.usd, order.currency, await getUsdRates());
    const cost = Math.round(offers.reduce((s, o) => s + landedCost({ supplierCost: o.price, supplierShipping: o.shipping }), 0) * 100) / 100;
    const { fees, profit } = orderProfit(order.saleTotal, cost, order.marketplace);
    if (profit < 0 && !opts.force) {
      await db.order.update({ where: { id: orderId }, data: { supplierCost: cost, fees, profit } });
      return await fail("NEEDS_REVIEW", "LOSS", `${profit.toFixed(2)} ${order.currency}`);
    }

    // Commande chez CJ, payée avec le solde (payType 2). Le numéro EB-<commande eBay> est unique chez CJ.
    let created: Awaited<ReturnType<typeof cj.createOrder>>;
    try {
      created = await cj.createOrder(
        token,
        { orderNumber: supplierOrderNumber(order.ebayOrderId), logisticName: q.logisticName, ...cjAddress(to), products: lines.map((l) => ({ vid: l.vid, quantity: l.quantity })) },
        country,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isDuplicateError(msg)) return await fail("NEEDS_REVIEW", "DUPLICATE", msg);
      if (isBalanceError(msg)) return await fail("FAILED", "CJ_BALANCE", msg);
      return await fail("FAILED", "CJ_ERROR", msg);
    }
    await db.order.update({
      where: { id: orderId },
      data: { status: "ORDERED", supplierOrderId: created.orderId, supplierCost: cost, fees, profit, orderedAt: new Date() },
    });
    return "ORDERED";
  } catch (e) {
    console.error("Commande auto", order.ebayOrderId, e);
    if (e instanceof EbayReconnectRequired || (e instanceof EbayApiError && e.status === 401)) return await fail("NEEDS_REVIEW", "EBAY_RECONNECT");
    // Erreur avant l'envoi chez CJ : on réessaiera au prochain passage (5 essais au maximum).
    if (order.attempts >= MAX_ATTEMPTS) return await fail("NEEDS_REVIEW", "RETRY_LIMIT", e instanceof Error ? e.message : String(e));
    await db.order.update({ where: { id: orderId }, data: { status: "PENDING", errorCode: "RETRY", errorMessage: (e instanceof Error ? e.message : String(e)).slice(0, 1000) } });
    return "RETRY";
  }
}

/** 3. Numéros de suivi : lus chez CJ, renvoyés à eBay. */
export async function syncTracking(user: UserWithAccounts): Promise<number> {
  const token = cjToken(user);
  if (!token) return 0;
  const orders = await db.order.findMany({ where: { userId: user.id, status: "ORDERED", supplierOrderId: { not: null } }, take: 50, orderBy: { orderedAt: "asc" } });
  let shipped = 0;
  for (const o of orders) {
    try {
      const d = await cj.getOrderDetail(token, o.supplierOrderId!);
      if (d.orderStatus === "CANCELLED") {
        await db.order.update({ where: { id: o.id }, data: { status: "FAILED", errorCode: "CJ_CANCELLED" } });
        continue;
      }
      if (!d.trackNumber) continue;
      const account = user.ebayAccounts.find((a) => a.id === o.ebayAccountId);
      if (!account) continue;
      const carrier = ebayCarrierCode(d.logisticName, d.trackNumber);
      const lines = o.lines as unknown as OrderLine[];
      try {
        await ebay.addTracking(await userToken(account), o.ebayOrderId, lines.map((l) => ({ lineItemId: l.lineItemId, quantity: l.quantity })), carrier, d.trackNumber);
      } catch (e) {
        await db.order.update({
          where: { id: o.id },
          data: { trackingNumber: d.trackNumber, carrier, errorCode: "EBAY_TRACKING", errorMessage: (e instanceof EbayApiError ? e.readable : String(e)).slice(0, 1000) },
        });
        continue;
      }
      await db.order.update({
        where: { id: o.id },
        data: { status: "SHIPPED", trackingNumber: d.trackNumber, carrier, shippedAt: new Date(), errorCode: null, errorMessage: null },
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

export interface RunReport { imported: number; ordered: number; review: number; shipped: number; errors: string[] }

/** Cycle complet pour un vendeur. */
export async function runForUser(user: UserWithAccounts): Promise<RunReport> {
  const report: RunReport = { imported: 0, ordered: 0, review: 0, shipped: 0, errors: [] };
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
  return report;
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
