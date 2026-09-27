/**
 * Surveillance du stock et des prix, toutes les heures :
 * relit chaque annonce chez son fournisseur (CJ ou AliExpress), met en pause (quantité 0) ce qui n'est plus rentable ou plus en stock,
 * relance automatiquement ce qui redevient bon, et ajuste la quantité affichée au stock réel.
 */
import type { User } from "@prisma/client";
import { db } from "@/lib/db";
import * as ebay from "@/lib/ebay";
import { userToken } from "@/lib/ebay-account";
import { convertFromUsd, getUsdRates, type Rates } from "@/lib/fx";
import { landedCost } from "@/lib/margin";
import { marketplace } from "@/lib/marketplaces";
import { openSession, quote, type Session, type SupplierId } from "@/lib/suppliers";
import { CHECK_EVERY_MS, decide, type MonitorDecision } from "@/lib/monitor";

type Account = { id: string; accessToken: string; accessTokenExpires: Date; refreshToken: string; refreshTokenExpires: Date };
type UserWithAccounts = User & {
  ebayAccounts: Account[];
  supplierAccounts: { id?: string; supplier: string; accessToken: string; refreshToken?: string | null; expiresAt?: Date | null }[];
};

const PER_RUN = 60;

export interface MonitorReport { checked: number; paused: number; resumed: number; updated: number; errors: number }

export async function monitorUser(user: UserWithAccounts, opts: { now?: number; force?: boolean } = {}): Promise<MonitorReport> {
  const now = opts.now ?? Date.now();
  const report: MonitorReport = { checked: 0, paused: 0, resumed: 0, updated: 0, errors: 0 };
  if (user.plan === "NONE") return report;

  const listings = await db.listing.findMany({
    where: {
      userId: user.id,
      status: { in: ["ACTIVE", "PAUSED"] },
      ebayOfferId: { not: null },
      ...(opts.force ? {} : { OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: new Date(now - CHECK_EVERY_MS) } }] }),
    },
    orderBy: { lastCheckedAt: { sort: "asc", nulls: "first" } },
    take: PER_RUN,
  });
  if (!listings.length) return report;

  let rates: Rates | null = null;
  const cache = new Map<string, Promise<unknown>>(); // une seule lecture par produit et par passage
  const sessions = new Map<SupplierId, Session | null>();
  const changes = new Map<string, { listing: (typeof listings)[number]; decision: MonitorDecision }[]>(); // par compte eBay

  for (const l of listings) {
    const m = marketplace(l.marketplace);
    const supplierId = l.supplier as SupplierId;
    try {
      if (!sessions.has(supplierId)) sessions.set(supplierId, await openSession(user.supplierAccounts, supplierId).catch(() => null));
      const session = sessions.get(supplierId);
      if (!session || !l.supplierVariantId) continue; // fournisseur déconnecté : on ne touche à rien
      // Une panne passagère lève une erreur (comptée, rien n'est modifié) ; « gone » = produit retiré.
      const q = await quote(session, l.supplierProductId, l.supplierVariantId, 1, m.country, cache);
      let supplier: Parameters<typeof decide>[0]["supplier"] = { found: false };
      if (q.kind === "no_stock") supplier = { found: true, stock: 0, cost: null, deliveryDaysMax: 99 };
      else if (q.kind === "no_route") supplier = { found: true, stock: q.stock, cost: null, deliveryDaysMax: 99 };
      else if (q.kind === "ok") {
        let price = q.unitPrice;
        let shipping = q.shipping;
        if (m.currency !== "USD") {
          rates ??= await getUsdRates();
          price = convertFromUsd(price, m.currency, rates);
          shipping = convertFromUsd(shipping, m.currency, rates);
        }
        supplier = { found: true, stock: q.stock, cost: landedCost({ supplierCost: price, supplierShipping: shipping, supplierTaxRate: q.taxRate }), deliveryDaysMax: q.deliveryDaysMax };
      }
      const decision = decide({ status: l.status as "ACTIVE" | "PAUSED", price: l.price, quantity: l.quantity, marketId: m.id, minMarginPct: user.minMarginPct, supplier });
      report.checked++;
      const needsEbay =
        decision.action === "RESUME" || decision.action === "SET_QUANTITY" || (decision.action === "PAUSE" && l.status === "ACTIVE");
      if (needsEbay && l.ebayAccountId) {
        const list = changes.get(l.ebayAccountId) ?? [];
        list.push({ listing: l, decision });
        changes.set(l.ebayAccountId, list);
      } else {
        // Rien à changer sur eBay : on note seulement la vérification (et la raison si déjà en pause).
        await db.listing.update({
          where: { id: l.id },
          data: {
            lastCheckedAt: new Date(now),
            ...("marginPct" in decision && decision.marginPct !== undefined ? { lastMarginPct: decision.marginPct } : {}),
            ...("cost" in decision && decision.cost !== undefined ? { supplierCost: decision.cost } : {}),
            ...(decision.action === "PAUSE" ? { pauseReason: decision.reason, pauseDetail: decision.detail ?? null } : {}),
          },
        });
      }
    } catch (e) {
      report.errors++;
      console.error("Surveillance", l.sku, e);
    }
  }

  // Envoi groupé à eBay, compte par compte.
  for (const [accountId, list] of changes) {
    const account = user.ebayAccounts.find((a) => a.id === accountId);
    if (!account) continue;
    let results: { sku: string; ok: boolean; message?: string }[];
    try {
      const qty = (d: MonitorDecision) => (d.action === "PAUSE" ? 0 : "quantity" in d ? d.quantity : 0);
      results = await ebay.bulkUpdateQuantity(
        await userToken(account),
        list.map(({ listing, decision }) => ({ sku: listing.sku, offerId: listing.ebayOfferId!, quantity: qty(decision) })),
      );
    } catch (e) {
      report.errors += list.length;
      console.error("Surveillance eBay", e);
      continue;
    }
    for (const { listing, decision } of list) {
      const r = results.find((x) => x.sku === listing.sku);
      if (!r?.ok) {
        report.errors++;
        await db.listing.update({ where: { id: listing.id }, data: { lastCheckedAt: new Date(now), errorMessage: r?.message?.slice(0, 1000) ?? "eBay" } });
        continue;
      }
      const common = {
        lastCheckedAt: new Date(now),
        errorMessage: null,
        ...("marginPct" in decision && decision.marginPct !== undefined ? { lastMarginPct: decision.marginPct } : {}),
        ...("cost" in decision && decision.cost !== undefined ? { supplierCost: decision.cost } : {}),
      };
      if (decision.action === "PAUSE") {
        report.paused++;
        await db.listing.update({ where: { id: listing.id }, data: { ...common, status: "PAUSED", pauseReason: decision.reason, pauseDetail: decision.detail ?? null } });
      } else if (decision.action === "RESUME") {
        report.resumed++;
        await db.listing.update({ where: { id: listing.id }, data: { ...common, status: "ACTIVE", quantity: decision.quantity, pauseReason: null, pauseDetail: null } });
      } else if (decision.action === "SET_QUANTITY") {
        report.updated++;
        await db.listing.update({ where: { id: listing.id }, data: { ...common, quantity: decision.quantity } });
      }
    }
  }
  return report;
}

/** Tous les vendeurs actifs (tâche planifiée), dans la limite de temps donnée. */
export async function monitorAll(deadline: number): Promise<{ users: number; reports: MonitorReport[] }> {
  const users = await db.user.findMany({
    where: { plan: { not: "NONE" }, listings: { some: { status: { in: ["ACTIVE", "PAUSED"] } } } },
    include: { ebayAccounts: { orderBy: { createdAt: "asc" } }, supplierAccounts: true },
  });
  const reports: MonitorReport[] = [];
  for (const u of users) {
    if (Date.now() > deadline) break;
    try {
      reports.push(await monitorUser(u));
    } catch (e) {
      console.error("Surveillance", u.id, e);
    }
  }
  return { users: users.length, reports };
}
