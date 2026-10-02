/**
 * Pilote automatique : une fois par jour, le Sniper cherche et publie N produits rentables dans les catégories
 * choisies par le vendeur (mêmes règles que la publication manuelle : marge minimum, livraison ≤ 8 jours,
 * marques protégées bloquées, limites du forfait).
 */
import { db } from "@/lib/db";
import { isCategoryId, MAX_TARGET } from "@/lib/sniper";
import { createRun, SnipeError, type UserWithAccounts } from "@/lib/sniper-service";
import { marketplace } from "@/lib/marketplaces";

export const AUTOPILOT_EVERY_MS = 24 * 3600_000;
export const AUTOPILOT_MAX_PER_DAY = 20;
/** Raisons d'arrêt : le pilote se coupe et le vendeur doit agir (réglages eBay, forfait…). */
const STOP = new Set(["PLAN_REQUIRED", "CJ_REQUIRED", "EBAY_NOT_CONNECTED"]);

export const autopilotCategories = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isCategoryId).slice(0, 5) : []);

/** Le pilote doit-il lancer une recherche maintenant ? */
export function autopilotDue(u: { autopilot: boolean; plan: string; autopilotLastRunAt: Date | null }, now = Date.now()): boolean {
  if (!u.autopilot || u.plan === "NONE") return false;
  return !u.autopilotLastRunAt || now - u.autopilotLastRunAt.getTime() >= AUTOPILOT_EVERY_MS;
}

/** Lance la recherche du jour pour un vendeur ; renvoie le code du résultat. */
export async function runAutopilot(user: UserWithAccounts & { autopilotPerDay: number; autopilotCategories: unknown }, now = Date.now()): Promise<string> {
  const setup = user.ebayAccounts[0]
    ? await db.ebayMarketSetup.findUnique({ where: { ebayAccountId_marketplaceId: { ebayAccountId: user.ebayAccounts[0].id, marketplaceId: marketplace(user.defaultMarketplace).id } }, select: { id: true } })
    : null;
  if (!setup) {
    await db.user.update({ where: { id: user.id }, data: { autopilotLastRunAt: new Date(now) } });
    return "EBAY_SETUP_REQUIRED";
  }
  try {
    await createRun(user, {
      mode: "CATALOG",
      marketId: marketplace(user.defaultMarketplace).id,
      target: Math.max(1, Math.min(AUTOPILOT_MAX_PER_DAY, MAX_TARGET, user.autopilotPerDay)),
      seeds: [],
      categories: autopilotCategories(user.autopilotCategories),
      autoList: true,
      ebayAccountId: user.ebayAccounts[0].id,
    });
    await db.user.update({ where: { id: user.id }, data: { autopilotLastRunAt: new Date(now) } });
    return "STARTED";
  } catch (e) {
    if (e instanceof SnipeError) {
      // Une recherche est déjà en cours : on réessaiera au prochain passage.
      if (e.code === "SNIPE_RUNNING") return "BUSY";
      await db.user.update({ where: { id: user.id }, data: { autopilotLastRunAt: new Date(now), ...(STOP.has(e.code) ? { autopilot: false } : {}) } });
      return e.code;
    }
    throw e;
  }
}

/** Passage planifié : lance la recherche du jour des vendeurs dont le pilote est dû. */
export async function autopilotAll(now = Date.now()): Promise<number> {
  const users = await db.user.findMany({
    where: { autopilot: true, plan: { not: "NONE" }, OR: [{ autopilotLastRunAt: null }, { autopilotLastRunAt: { lt: new Date(now - AUTOPILOT_EVERY_MS) } }] },
    include: { ebayAccounts: { orderBy: { createdAt: "asc" } }, supplierAccounts: true },
    take: 50,
  });
  let started = 0;
  for (const u of users) {
    if (!autopilotDue(u, now)) continue;
    try {
      if ((await runAutopilot(u, now)) === "STARTED") started++;
    } catch (e) {
      console.error("Pilote automatique", u.id, e);
    }
  }
  return started;
}
