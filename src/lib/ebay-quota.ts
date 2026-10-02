/**
 * Quota de l'API Browse d'eBay (nombre d'appels par jour pour toute l'application Sellvela).
 * - Quand eBay répond « trop de requêtes », tout le monde se met en pause jusqu'à la remise à zéro
 *   (au lieu d'échouer produit après produit).
 * - Le scanner de fond ne consomme que la moitié haute du quota : le reste est gardé pour les vendeurs.
 * - Les recherches eBay déjà faites sont gardées 6 h : un même mot-clé ne coûte qu'une fois.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { createHash } from "node:crypto";
import { countActive, getBrowseQuota, isQuotaError, searchByImage, searchWithDemand, soldQuantities, type BrowseQuota, type DemandSnapshot } from "@/lib/ebay";
import { costBand, monthlySales, pickComparables } from "@/lib/comparables";
import type { MarketplaceId } from "@/lib/marketplaces";

const PAUSE_KEY = "ebay:browse:pause";
const QUOTA_KEY = "ebay:browse:quota";
const QUOTA_TTL_MS = 10 * 60_000;
/** Pause quand eBay ne dit pas quand le compteur repart. */
const DEFAULT_PAUSE_MS = 30 * 60_000;
/** Pause maximale (le compteur eBay est journalier). */
const MAX_PAUSE_MS = 24 * 3600_000;
/** Part du quota réservée aux vendeurs : le scanner s'arrête en dessous. */
export const SCANNER_RESERVE = 0.5;
/** Contrat eBay : les infos d'annonces ne doivent pas avoir plus de 6 h de retard sur eBay. */
export const DEMAND_CACHE_MS = 6 * 3600_000;

export async function readState<T>(key: string): Promise<T | null> {
  const row = await db.appState.findUnique({ where: { key } });
  if (!row || (row.expiresAt && row.expiresAt.getTime() <= Date.now())) return null;
  return row.value as T;
}

export async function writeState(key: string, value: Prisma.InputJsonValue, expiresAt: Date) {
  await db.appState.upsert({ where: { key }, create: { key, value, expiresAt }, update: { value, expiresAt } });
}

/** Heure de reprise si eBay a coupé l'accès, sinon null. */
export async function quotaPausedUntil(): Promise<Date | null> {
  const p = await readState<{ until: string }>(PAUSE_KEY);
  return p ? new Date(p.until) : null;
}

/** Heure de reprise calculée à partir de la remise à zéro annoncée par eBay (bornée). */
export function resumeAt(reset: string | null | undefined, now = Date.now()): Date {
  const t = reset ? Date.parse(reset) : NaN;
  if (Number.isFinite(t) && t > now) return new Date(Math.min(t, now + MAX_PAUSE_MS) + 60_000);
  return new Date(now + DEFAULT_PAUSE_MS);
}

/** À appeler quand eBay répond 429 : met tout le monde en pause jusqu'à la remise à zéro. */
export async function pauseForQuota(): Promise<Date> {
  let reset: string | null = null;
  try {
    reset = (await getBrowseQuota())?.reset ?? null;
  } catch {
    /* API Analytics indisponible : pause par défaut */
  }
  const until = resumeAt(reset);
  await writeState(PAUSE_KEY, { until: until.toISOString() }, until);
  return until;
}

/** Quota du jour (gardé 10 min pour ne pas interroger eBay sans arrêt). */
export async function browseQuota(): Promise<BrowseQuota | null> {
  const cached = await readState<BrowseQuota>(QUOTA_KEY);
  if (cached) return cached;
  try {
    const q = await getBrowseQuota();
    if (q) await writeState(QUOTA_KEY, q as unknown as Prisma.InputJsonValue, new Date(Date.now() + QUOTA_TTL_MS));
    return q;
  } catch {
    return null;
  }
}

/** Le scanner de fond peut-il dépenser du quota ? (jamais quand il en reste moins de la moitié) */
export function scannerMayRun(q: BrowseQuota | null): boolean {
  if (!q || !q.limit) return true;
  return q.remaining > q.limit * SCANNER_RESERVE;
}

const demandKey = (q: string, sample: number, marketId: MarketplaceId) =>
  `demand:${marketId}:${sample}:${q.toLowerCase().replace(/\s+/g, " ").trim()}`;

/** Prix + ventes eBay pour un mot-clé, avec cache 6 h partagé par tous les vendeurs. */
export async function cachedDemand(q: string, sample: number, marketId: MarketplaceId): Promise<DemandSnapshot> {
  const key = demandKey(q, sample, marketId);
  const hit = await readState<DemandSnapshot>(key);
  if (hit) return hit;
  const fresh = await searchWithDemand(q, sample, marketId);
  await writeState(key, fresh as unknown as Prisma.InputJsonValue, new Date(Date.now() + DEMAND_CACHE_MS));
  return fresh;
}

/**
 * Recherche par mots-clés : on écarte les annonces dont le prix est impossible pour ce produit
 * (autre produit plus gros ou accessoire), puis on recalcule ventes et rythme mensuel. Aucun appel en plus.
 */
export function keepPlausible(d: DemandSnapshot, supplierCost?: number | null): DemandSnapshot {
  if (!supplierCost) return d;
  const band = costBand(supplierCost);
  const ok = (p: number) => p >= band.min && p <= band.max;
  const analyzed = d.analyzed.filter((i) => ok(i.price));
  return {
    ...d,
    prices: d.prices.filter(ok),
    items: d.items.filter((i) => ok(i.price)),
    analyzed,
    soldWeighted: analyzed.map((i) => ({ price: i.price, weight: i.sold })),
    unitsSold: analyzed.reduce((s, i) => s + i.sold, 0),
    monthlySales: monthlySales(analyzed),
    search: d.search ? { ...d.search, cost: supplierCost } : undefined,
  };
}

/** Photos plus lourdes : pas de recherche par image (lente et refusée par eBay au-delà de quelques Mo). */
const MAX_IMAGE_BYTES = 3_000_000;
/** Moins d'annonces vraiment comparables que ça : la recherche par mots-clés prend le relais. */
export const MIN_IMAGE_MATCHES = 3;

async function imageBase64(url: string): Promise<string | null> {
  if (!/^https:\/\//.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length && buf.length <= MAX_IMAGE_BYTES ? buf.toString("base64") : null;
  } catch {
    return null;
  }
}

/**
 * Marché d'un produit fournisseur d'après sa PHOTO (recherche eBay par image) :
 * 1. annonces les plus ressemblantes, filtrées (titre et prix cohérents) ;
 * 2. ventes estimées de ces annonces (total et par mois) ;
 * 3. concurrents = recherche précise construite à partir d'elles (mots communs + catégorie + gamme de prix).
 * Sans photo exploitable ou avec trop peu d'annonces comparables : recherche par mots-clés (méthode d'avant).
 * Gardé 6 h comme les autres recherches eBay.
 */
export async function cachedImageDemand(imageUrl: string | null, keyword: string, sample: number, marketId: MarketplaceId, supplierCost?: number | null): Promise<DemandSnapshot> {
  const byKeyword = async () => keepPlausible(await cachedDemand(keyword, sample, marketId), supplierCost);
  if (!imageUrl) return byKeyword();
  const anchor = supplierCost ? Math.round(supplierCost) : 0;
  const key = `idemand:${marketId}:${sample}:${anchor}:${createHash("sha1").update(imageUrl).digest("hex")}`;
  const hit = await readState<DemandSnapshot>(key);
  if (hit) return hit;
  const image = await imageBase64(imageUrl);
  if (!image) return byKeyword();
  let found;
  try {
    found = await searchByImage(image, 50, marketId);
  } catch (e) {
    if (isQuotaError(e)) throw e;
    console.error("Recherche eBay par image", e);
    return byKeyword();
  }
  const set = pickComparables(found.items, { supplierCost });
  if (set.matches.length < MIN_IMAGE_MATCHES) return byKeyword();

  const sampled = set.matches.slice(0, sample);
  const sold = await soldQuantities(sampled.map((i) => i.id), marketId);
  const analyzed = sampled.filter((i) => sold.has(i.id)).map((i) => ({ ...i, sold: sold.get(i.id)! }));
  const q = set.keywords.length >= 2 ? set.keywords.join(" ") : keyword;
  let total = set.matches.length;
  try {
    total = Math.max(total, await countActive(q, { categoryId: set.categoryId, priceMin: set.priceMin, priceMax: set.priceMax }, marketId));
  } catch (e) {
    if (isQuotaError(e)) throw e;
    console.error("Concurrents eBay", e);
  }
  const fresh: DemandSnapshot = {
    total,
    prices: set.matches.map((i) => i.price).filter((p) => p > 0),
    items: set.matches,
    analyzed,
    soldWeighted: analyzed.map((i) => ({ price: i.price, weight: i.sold })),
    unitsSold: analyzed.reduce((s, i) => s + i.sold, 0),
    monthlySales: monthlySales(analyzed),
    method: "IMAGE",
    search: { q, categoryId: set.categoryId, priceMin: set.priceMin, priceMax: set.priceMax, cost: supplierCost ?? null },
  };
  await writeState(key, fresh as unknown as Prisma.InputJsonValue, new Date(Date.now() + DEMAND_CACHE_MS));
  return fresh;
}

/**
 * Ménage (appelé par le scanner) : le contrat eBay demande de supprimer les copies de données eBay
 * dès qu'elles ne servent plus. Supprime les caches expirés et les données des fonctions retirées
 * (meilleures ventes eBay, vendeurs concurrents suivis, analyses de vendeurs).
 */
export async function purgeExpiredState(): Promise<number> {
  const counts = await Promise.all([
    db.appState.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
    db.researchCache.deleteMany({ where: { OR: [{ createdAt: { lt: new Date(Date.now() - 6 * 3600_000) } }, { key: { startsWith: "seller:" } }] } }),
    db.trendItem.deleteMany({}),
    db.savedSeller.deleteMany({}),
  ]);
  return counts.reduce((s, r) => s + r.count, 0);
}
