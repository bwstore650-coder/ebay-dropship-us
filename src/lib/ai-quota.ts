/**
 * Quota mensuel de rédactions IA (titres, descriptions) selon la formule.
 * Une génération = un appel à l'IA (un brouillon d'annonce, 3 titres, ou une description).
 */
import type { Plan } from "@prisma/client";
import { db } from "@/lib/db";
import { planInfo } from "@/lib/plans";

/** Formule « illimitée » : plafond de sécurité (usage raisonnable), jamais atteint par un usage normal. */
export const AI_FAIR_USE = 20_000;

export class AiLimitError extends Error {
  constructor(readonly limit: number) {
    super("AI_LIMIT");
  }
}

export const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);

/** Limite du mois : 0 sans formule ; null dans la formule = illimité (plafond de sécurité). */
export function aiLimit(plan: Plan): { limit: number; unlimited: boolean } {
  const p = planInfo(plan);
  if (!p) return { limit: 0, unlimited: false };
  return p.aiPerMonth === null ? { limit: AI_FAIR_USE, unlimited: true } : { limit: p.aiPerMonth, unlimited: false };
}

export async function aiUsage(user: { id: string; plan: Plan }) {
  const row = await db.aiUsage.findUnique({ where: { userId_month: { userId: user.id, month: monthKey() } } });
  const { limit, unlimited } = aiLimit(user.plan);
  return { used: row?.count ?? 0, limit, unlimited };
}

/** Réserve une génération (atomique) ; AiLimitError si le quota du mois est atteint. */
export async function takeAiCredit(user: { id: string; plan: Plan }): Promise<void> {
  const { limit } = aiLimit(user.plan);
  if (limit <= 0) throw new AiLimitError(0);
  const month = monthKey();
  const row = await db.aiUsage.upsert({
    where: { userId_month: { userId: user.id, month } },
    create: { userId: user.id, month, count: 1 },
    update: { count: { increment: 1 } },
  });
  if (row.count > limit) {
    await db.aiUsage.update({ where: { userId_month: { userId: user.id, month } }, data: { count: { decrement: 1 } } });
    throw new AiLimitError(limit);
  }
}

/** Rend une génération quand l'IA n'a rien produit (erreur, pas de clé) : le vendeur ne paie pas un échec. */
export async function refundAiCredit(user: { id: string }): Promise<void> {
  await db.aiUsage
    .updateMany({ where: { userId: user.id, month: monthKey(), count: { gt: 0 } }, data: { count: { decrement: 1 } } })
    .catch(() => {});
}
