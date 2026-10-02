/**
 * Questions des acheteurs : relues sur eBay, une réponse est préparée par l'IA avec les vraies infos de la
 * commande (statut, numéro de suivi), puis le vendeur l'envoie d'un clic. Rien n'est envoyé sans lui.
 */
import { db } from "@/lib/db";
import * as ebay from "@/lib/ebay";
import { userToken } from "@/lib/ebay-account";
import { aiConfigured, writeBuyerReply } from "@/lib/ai";
import { AiLimitError, refundAiCredit, takeAiCredit } from "@/lib/ai-quota";
import { marketplace, type MarketplaceId } from "@/lib/marketplaces";
import type { UserWithAccounts } from "@/lib/sniper-service";

const DAY = 86_400_000;
/** Fenêtre relue sur eBay. */
export const LOOKBACK_DAYS = 7;
/** Réponses préparées par l'IA à chaque passage (chacune = 1 génération du forfait). */
export const DRAFTS_PER_RUN = 5;

export class MessageError extends Error {
  constructor(readonly code: "NOT_FOUND" | "ALREADY_REPLIED" | "EMPTY" | "EBAY_REFUSED" | "AI_LIMIT" | "AI_NOT_CONFIGURED") {
    super(code);
  }
}

type Account = UserWithAccounts["ebayAccounts"][number];

/** Commande de cet acheteur la plus pertinente : même annonce si possible, sinon la plus récente. */
async function orderFor(userId: string, accountId: string, buyer: string, itemId: string | null) {
  const orders = await db.order.findMany({
    where: { userId, ebayAccountId: accountId, buyerUsername: buyer },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, status: true, createdAt: true, orderedAt: true, shippedAt: true, trackingNumber: true, carrier: true, lines: true },
  });
  if (!orders.length) return null;
  const sameItem = itemId ? orders.find((o) => ((o.lines as { legacyItemId?: string }[] | null) ?? []).some((l) => l.legacyItemId === itemId)) : undefined;
  return sameItem ?? orders[0];
}

/** Prépare (ou refait) la réponse d'une question ; 1 génération IA. */
export async function draftMessage(user: { id: string; plan: UserWithAccounts["plan"] }, id: string): Promise<string> {
  if (!aiConfigured()) throw new MessageError("AI_NOT_CONFIGURED");
  const msg = await db.buyerMessage.findFirst({ where: { id, userId: user.id } });
  if (!msg) throw new MessageError("NOT_FOUND");
  if (msg.status !== "NEW") throw new MessageError("ALREADY_REPLIED");
  const order = msg.orderId
    ? await db.order.findFirst({ where: { id: msg.orderId, userId: user.id }, select: { status: true, createdAt: true, orderedAt: true, shippedAt: true, trackingNumber: true, carrier: true } })
    : null;
  try {
    await takeAiCredit(user);
  } catch (e) {
    if (e instanceof AiLimitError) {
      await db.buyerMessage.update({ where: { id }, data: { draftError: "AI_LIMIT" } });
      throw new MessageError("AI_LIMIT");
    }
    throw e;
  }
  try {
    const draft = await writeBuyerReply({
      language: marketplace(msg.marketplace as MarketplaceId).listingLanguage,
      buyer: msg.buyer,
      question: msg.body,
      itemTitle: msg.itemTitle,
      order: order
        ? { status: order.status, createdAt: order.createdAt.toISOString(), orderedAt: order.orderedAt?.toISOString() ?? null, shippedAt: order.shippedAt?.toISOString() ?? null, trackingNumber: order.trackingNumber, carrier: order.carrier }
        : null,
    });
    await db.buyerMessage.update({ where: { id }, data: { draft, draftAt: new Date(), draftError: null } });
    return draft;
  } catch (e) {
    await refundAiCredit(user);
    await db.buyerMessage.update({ where: { id }, data: { draftError: "AI_FAILED" } });
    throw e;
  }
}

/** Relit les questions sans réponse de chaque compte eBay, rattache la commande et prépare quelques réponses. */
export async function syncBuyerMessages(user: UserWithAccounts, opts: { now?: number; drafts?: number } = {}): Promise<{ added: number; drafted: number }> {
  const now = opts.now ?? Date.now();
  const since = new Date(now - LOOKBACK_DAYS * DAY);
  let added = 0;
  for (const account of user.ebayAccounts as (Account & { id: string })[]) {
    const marketId = marketplace(user.defaultMarketplace).id;
    const token = await userToken(account);
    const questions = await ebay.getUnansweredQuestions(token, since, marketId);
    const open = new Set(questions.map((q) => q.messageId));
    for (const q of questions) {
      const exists = await db.buyerMessage.findUnique({ where: { ebayAccountId_messageId: { ebayAccountId: account.id, messageId: q.messageId } }, select: { id: true } });
      if (exists) continue;
      const order = await orderFor(user.id, account.id, q.buyer, q.itemId);
      await db.buyerMessage.create({
        data: {
          userId: user.id, ebayAccountId: account.id, marketplace: marketId, messageId: q.messageId, itemId: q.itemId, itemTitle: q.itemTitle,
          buyer: q.buyer, subject: q.subject, body: q.body.slice(0, 4000), questionType: q.questionType,
          receivedAt: q.receivedAt ? new Date(q.receivedAt) : new Date(now), orderId: order?.id ?? null,
        },
      });
      added++;
    }
    // Répondues directement sur eBay entre-temps : plus à traiter ici.
    await db.buyerMessage.updateMany({
      where: { userId: user.id, ebayAccountId: account.id, status: "NEW", receivedAt: { gte: since }, messageId: { notIn: [...open] } },
      data: { status: "REPLIED" },
    });
  }
  let drafted = 0;
  if (aiConfigured()) {
    const todo = await db.buyerMessage.findMany({ where: { userId: user.id, status: "NEW", draft: null, draftError: null }, orderBy: { receivedAt: "asc" }, take: opts.drafts ?? DRAFTS_PER_RUN, select: { id: true } });
    for (const m of todo) {
      try {
        await draftMessage(user, m.id);
        drafted++;
      } catch (e) {
        if (e instanceof MessageError && e.code === "AI_LIMIT") break;
        console.error("Réponse acheteur (IA)", m.id, e);
      }
    }
  }
  return { added, drafted };
}

/** Envoie la réponse (texte relu, éventuellement modifié, par le vendeur). */
export async function sendReply(user: UserWithAccounts, id: string, body: string): Promise<void> {
  const text = body.trim().slice(0, 2000);
  if (!text) throw new MessageError("EMPTY");
  const msg = await db.buyerMessage.findFirst({ where: { id, userId: user.id } });
  if (!msg) throw new MessageError("NOT_FOUND");
  if (msg.status !== "NEW") throw new MessageError("ALREADY_REPLIED");
  const account = user.ebayAccounts.find((a) => a.id === msg.ebayAccountId);
  if (!account) throw new MessageError("NOT_FOUND");
  try {
    await ebay.answerBuyerQuestion(await userToken(account), { itemId: msg.itemId, parentMessageId: msg.messageId, buyer: msg.buyer, body: text }, msg.marketplace as MarketplaceId);
  } catch (e) {
    console.error("Réponse acheteur (eBay)", id, e);
    throw new MessageError("EBAY_REFUSED");
  }
  await db.buyerMessage.update({ where: { id }, data: { status: "REPLIED", draft: text, repliedAt: new Date() } });
}

export async function dismissMessage(userId: string, id: string): Promise<void> {
  const r = await db.buyerMessage.updateMany({ where: { id, userId, status: "NEW" }, data: { status: "DISMISSED" } });
  if (!r.count) throw new MessageError("NOT_FOUND");
}

/** Passage planifié pour tous les vendeurs (questions + brouillons). */
export async function syncAllMessages(deadline: number): Promise<{ users: number; added: number; drafted: number }> {
  const users = await db.user.findMany({ where: { plan: { not: "NONE" }, ebayAccounts: { some: {} } }, include: { ebayAccounts: { orderBy: { createdAt: "asc" } }, supplierAccounts: true } });
  let added = 0;
  let drafted = 0;
  for (const u of users) {
    if (Date.now() > deadline) break;
    try {
      const r = await syncBuyerMessages(u);
      added += r.added;
      drafted += r.drafted;
    } catch (e) {
      console.error("Questions acheteurs", u.id, e);
    }
  }
  return { users: users.length, added, drafted };
}
