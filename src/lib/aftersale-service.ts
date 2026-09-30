/**
 * Retours et annulations (côté serveur) : relevé eBay (API Post-Order), liaison avec nos commandes,
 * actions du vendeur (accepter l'annulation, accepter le retour, annuler chez le fournisseur).
 */
import type { User } from "@prisma/client";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import * as ebay from "@/lib/ebay";
import { userToken } from "@/lib/ebay-account";
import { marketplace, type MarketplaceId } from "@/lib/marketplaces";
import * as cj from "@/lib/suppliers/cj";
import { actionsFor, cancelToRow, returnToRow, type AfterSaleRow } from "@/lib/aftersale";

type Account = { id: string; accessToken: string; accessTokenExpires: Date; refreshToken: string; refreshTokenExpires: Date };
type UserWithAccounts = User & {
  ebayAccounts: Account[];
  supplierAccounts: { id?: string; supplier: string; accessToken: string }[];
};

export type AfterSaleErrorCode = "NOT_FOUND" | "NOT_ALLOWED" | "SUPPLIER_MANUAL";
export class AfterSaleError extends Error {
  constructor(readonly code: AfterSaleErrorCode) {
    super(code);
  }
}

/** Relève les retours et annulations de tous les comptes eBay du vendeur. Renvoie le nombre de dossiers ouverts. */
export async function syncAfterSales(user: UserWithAccounts): Promise<number> {
  for (const account of user.ebayAccounts) {
    let token: string;
    try {
      token = await userToken(account);
    } catch {
      continue;
    }
    // Pays où ce compte a des commandes récentes (l'API Post-Order répond par pays).
    const recent = await db.order.findMany({
      where: { ebayAccountId: account.id, createdAt: { gte: new Date(Date.now() - 60 * 86_400_000) } },
      select: { marketplace: true },
    });
    const markets = [...new Set<MarketplaceId>([marketplace(user.defaultMarketplace).id, ...recent.map((o) => marketplace(o.marketplace).id)])];
    for (const m of markets) {
      const rows: AfterSaleRow[] = [];
      let ok = true;
      try {
        rows.push(...(await ebay.searchReturns(token, m)).map(returnToRow));
        rows.push(...(await ebay.searchCancellations(token, m)).map(cancelToRow));
      } catch (e) {
        ok = false;
        console.error("Retours/annulations", account.id, m, e);
      }
      if (!ok) continue;
      const orders = await db.order.findMany({ where: { userId: user.id, ebayOrderId: { in: rows.map((r) => r.ebayOrderId) } }, select: { id: true, ebayOrderId: true, status: true } });
      const byEbayId = new Map(orders.map((o) => [o.ebayOrderId, o]));
      for (const r of rows) {
        const order = byEbayId.get(r.ebayOrderId);
        await db.afterSale.upsert({
          where: { type_ebayId: { type: r.type, ebayId: r.ebayId } },
          create: { ...r, userId: user.id, ebayAccountId: account.id, marketplace: m, orderId: order?.id ?? null },
          update: { state: r.state, open: r.open, amount: r.amount, currency: r.currency, reason: r.reason, buyerComment: r.buyerComment, ...(r.itemTitle ? { itemTitle: r.itemTitle } : {}), orderId: order?.id ?? null },
        });
        // Annulation demandée avant qu'on commande chez le fournisseur : on ne commandera pas.
        if (r.type === "CANCEL" && r.open && order && (order.status === "PENDING" || order.status === "NEEDS_REVIEW"))
          await db.order.update({ where: { id: order.id }, data: { status: "CANCELLED", errorCode: "CANCELLED_BY_BUYER" } });
      }
      // Retours qui ne sont plus ouverts chez eBay (la recherche ne renvoie que les retours ouverts).
      const openReturnIds = rows.filter((r) => r.type === "RETURN").map((r) => r.ebayId);
      await db.afterSale.updateMany({
        where: { userId: user.id, ebayAccountId: account.id, marketplace: m, type: "RETURN", open: true, ebayId: { notIn: openReturnIds } },
        data: { open: false },
      });
    }
  }
  return db.afterSale.count({ where: { userId: user.id, open: true } });
}

async function load(user: UserWithAccounts, id: string) {
  const a = await db.afterSale.findFirst({ where: { id, userId: user.id } });
  if (!a) throw new AfterSaleError("NOT_FOUND");
  const order = a.orderId ? await db.order.findUnique({ where: { id: a.orderId } }) : null;
  const account = user.ebayAccounts.find((x) => x.id === a.ebayAccountId);
  return { a, order, account, can: actionsFor(a, order) };
}

/** Accepter la demande d'annulation de l'acheteur. */
export async function approveCancel(user: UserWithAccounts, id: string) {
  const { a, account, can } = await load(user, id);
  if (!can.approveCancel || !account) throw new AfterSaleError("NOT_ALLOWED");
  await ebay.approveCancellation(await userToken(account), a.ebayId, marketplace(a.marketplace).id);
  await db.afterSale.update({ where: { id }, data: { action: "APPROVED", actionAt: new Date() } });
}

/** Accepter le retour de l'acheteur. */
export async function acceptReturn(user: UserWithAccounts, id: string) {
  const { a, account, can } = await load(user, id);
  if (!can.acceptReturn || !account) throw new AfterSaleError("NOT_ALLOWED");
  await ebay.acceptReturn(await userToken(account), a.ebayId, marketplace(a.marketplace).id);
  await db.afterSale.update({ where: { id }, data: { action: "ACCEPTED", actionAt: new Date() } });
}

/**
 * Annuler aussi la commande chez le fournisseur. CJ : possible par l'API tant que la commande n'est pas traitée ;
 * sinon (et pour AliExpress), le vendeur doit l'annuler depuis son compte fournisseur (SUPPLIER_MANUAL).
 */
export async function cancelSupplier(user: UserWithAccounts, id: string) {
  const { order, can } = await load(user, id);
  if (!can.cancelSupplier || !order?.supplierOrderId) throw new AfterSaleError("NOT_ALLOWED");
  const lines = (order.lines as unknown as { supplier?: string }[]) ?? [];
  const supplier = lines[0]?.supplier ?? "CJ";
  const acc = user.supplierAccounts.find((s) => s.supplier === "CJ");
  if (supplier !== "CJ" || !acc) throw new AfterSaleError("SUPPLIER_MANUAL");
  try {
    await cj.deleteOrder(decrypt(acc.accessToken), order.supplierOrderId);
  } catch (e) {
    console.error("Annulation CJ", order.supplierOrderId, e);
    throw new AfterSaleError("SUPPLIER_MANUAL");
  }
  await db.order.update({ where: { id: order.id }, data: { status: "CANCELLED", errorCode: "CANCELLED_BY_BUYER" } });
  await db.afterSale.update({ where: { id }, data: { action: "SUPPLIER_CANCELLED", actionAt: new Date() } });
}
