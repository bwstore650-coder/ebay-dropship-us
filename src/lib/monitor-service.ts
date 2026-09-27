/**
 * Surveillance du stock et des prix, toutes les heures :
 * relit chaque annonce chez CJ, met en pause (quantité 0) ce qui n'est plus rentable ou plus en stock,
 * relance automatiquement ce qui redevient bon, et ajuste la quantité affichée au stock réel.
 */
import type { User } from "@prisma/client";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import * as ebay from "@/lib/ebay";
import { userToken } from "@/lib/ebay-account";
import { convertFromUsd, getUsdRates, type Rates } from "@/lib/fx";
import { landedCost } from "@/lib/margin";
import { marketplace } from "@/lib/marketplaces";
import * as cj from "@/lib/suppliers/cj";
import { CHECK_EVERY_MS, decide, type MonitorDecision } from "@/lib/monitor";

type Account = { id: string; accessToken: string; accessTokenExpires: Date; refreshToken: string; refreshTokenExpires: Date };
type UserWithAccounts = User & { ebayAccounts: Account[]; supplierAccounts: { supplier: string; accessToken: string }[] };

const PER_RUN = 60;

/** Messages de CJ qui signifient « ce produit n'existe plus » (et non une panne passagère). */
const isGone = (msg: string) => /not\s*exist|not\s*found|removed|off[\s-]?shelf|下架/i.test(msg);

export interface MonitorReport { checked: number; paused: number; resumed: number; updated: number; errors: number }

export async function monitorUser(user: UserWithAccounts, opts: { now?: number; force?: boolean } = {}): Promise<MonitorReport> {
  const now = opts.now ?? Date.now();
  const report: MonitorReport = { checked: 0, paused: 0, resumed: 0, updated: 0, errors: 0 };
  const cjAcc = user.supplierAccounts.find((a) => a.supplier === "CJ");
  if (!cjAcc || user.plan === "NONE") return report;
  const token = decrypt(cjAcc.accessToken);

  const listings = await db.listing.findMany({
    where: {
      userId: user.id,
      status: { in: ["ACTIVE", "PAUSED"] },
      supplier: "CJ",
      ebayOfferId: { not: null },
      ...(opts.force ? {} : { OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: new Date(now - CHECK_EVERY_MS) } }] }),
    },
    orderBy: { lastCheckedAt: { sort: "asc", nulls: "first" } },
    take: PER_RUN,
  });
  if (!listings.length) return report;

  let rates: Rates | null = null;
  const products = new Map<string, cj.CjProduct | null>();
  const changes = new Map<string, { listing: (typeof listings)[number]; decision: MonitorDecision }[]>(); // par compte eBay

  for (const l of listings) {
    const m = marketplace(l.marketplace);
    try {
      // Fiche produit (une seule lecture par produit et par passage).
      if (!products.has(l.supplierProductId)) {
        try {
          products.set(l.supplierProductId, await cj.getProduct(token, l.supplierProductId));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (!isGone(msg)) throw e; // panne passagère : on ne touche à rien
          products.set(l.supplierProductId, null);
        }
      }
      const product = products.get(l.supplierProductId);
      const variant = product?.variants.find((v) => v.vid === l.supplierVariantId);
      let supplier: Parameters<typeof decide>[0]["supplier"] = { found: false };
      if (product && variant) {
        const stock = variant.inventories?.find((i) => i.countryCode === m.country)?.totalInventory ?? 0;
        let cost: number | null = null;
        let deliveryDaysMax = 99;
        if (stock > 0) {
          const options = await cj.freightCalculate(token, variant.vid, 1, m.country);
          if (options.length) {
            const cheapest = options.reduce((a, b) => (b.logisticPrice < a.logisticPrice ? b : a));
            deliveryDaysMax = cj.parseMaxDays(cheapest.logisticAging);
            let price = Number(variant.variantSellPrice);
            let shipping = Number(cheapest.logisticPrice);
            if (m.currency !== "USD") {
              rates ??= await getUsdRates();
              price = convertFromUsd(price, m.currency, rates);
              shipping = convertFromUsd(shipping, m.currency, rates);
            }
            cost = landedCost({ supplierCost: price, supplierShipping: shipping });
          }
        }
        supplier = { found: true, stock, cost, deliveryDaysMax };
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
