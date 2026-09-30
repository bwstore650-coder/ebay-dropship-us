/**
 * Base commune de produits déjà analysés (« pool »).
 *
 * Le scanner de fond (tâche planifiée) et chaque recherche Sniper analysent des produits du catalogue CJ
 * et enregistrent le résultat ici. Quand un vendeur lance le Sniper, on lui propose d'abord les produits
 * rentables de cette base (résultats immédiats), puis l'analyse en direct complète si besoin.
 *
 * Pour éviter que trop de vendeurs se fassent concurrence sur le même produit, un produit n'est plus proposé
 * dès que MAX_SELLERS_PER_PRODUCT vendeurs l'ont déjà reçu (Sniper, 14 derniers jours) ou mis en vente.
 */
import type { Prisma, ProductInsight } from "@prisma/client";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { parseAdminEmails } from "@/lib/admin";
import { findVeroBrand } from "@/lib/compliance";
import { searchWithDemand } from "@/lib/ebay";
import { getUsdRates, offersToCurrency } from "@/lib/fx";
import { DEFAULT_MIN_MARGIN_PCT, evaluateProduct, priceForTargetMargin, weightedMedian, type SupplierOffer } from "@/lib/margin";
import { marketplace, type MarketplaceId } from "@/lib/marketplaces";
import { marketInsights } from "@/lib/market-insights";
import * as cj from "@/lib/suppliers/cj";
import { type CandidateDetails, classify, DEFAULT_SEEDS, keywordFromTitle, MAX_VARIANTS, MIN_UNITS_SOLD } from "@/lib/sniper";

/** Un produit n'est plus proposé au-delà de ce nombre de vendeurs. */
export const MAX_SELLERS_PER_PRODUCT = 5;
/** Une analyse reste utilisable pendant ce délai (prix et stock revérifiés de toute façon avant la mise en vente). */
export const POOL_FRESH_MS = 48 * 3600_000;
/** Au-delà, le scanner réanalyse le produit. */
export const POOL_REFRESH_MS = 24 * 3600_000;
const EXPOSURE_WINDOW_MS = 14 * 86_400_000;

/** Rejets valables pour tout le monde (ne dépendent pas des réglages du vendeur). */
const HARD_REJECTS = new Set(["NO_SUPPLIER", "NO_PRICE", "NO_DEMAND", "VERO", "NO_KEYWORD"]);

export interface Analysis {
  status: "PROFITABLE" | "REJECTED";
  reason: string | null;
  title: string | null;
  image: string | null;
  variantId: string | null;
  marketPrice: number | null;
  cost: number | null;
  profit: number | null;
  marginPct: number | null;
  unitsSold: number;
  deliveryDaysMax: number | null;
  details: CandidateDetails;
}

export interface AnalyzeOptions {
  minMarginPct: number;
  minProfit?: number | null;
  priceMin?: number | null;
  priceMax?: number | null;
}

/** Offres pour un produit CJ : les variantes en stock dans le pays (les moins chères), avec la livraison la moins chère. */
async function cjOffersFor(token: string, product: cj.CjProduct, country: string): Promise<SupplierOffer[]> {
  const inStock = product.variants
    .map((v) => ({ v, stock: v.inventories?.find((i) => i.countryCode === country)?.totalInventory ?? 0 }))
    .filter((x) => x.stock > 0)
    .sort((a, b) => Number(a.v.variantSellPrice) - Number(b.v.variantSellPrice))
    .slice(0, MAX_VARIANTS);
  const offers: SupplierOffer[] = [];
  for (const { v, stock } of inStock) {
    const options = await cj.freightCalculate(token, v.vid, 1, country);
    if (!options.length) continue;
    const cheapest = options.reduce((a, b) => (b.logisticPrice < a.logisticPrice ? b : a));
    offers.push({
      supplier: "CJ",
      productId: product.pid,
      variantId: v.vid,
      title: `${product.productNameEn}${v.variantKey ? ` — ${v.variantKey}` : ""}`,
      price: Number(v.variantSellPrice),
      shipping: Number(cheapest.logisticPrice),
      stockUs: stock,
      deliveryDaysMax: cj.parseMaxDays(cheapest.logisticAging),
    });
  }
  return offers;
}

/**
 * Analyse complète d'un produit du catalogue CJ : stock local d'abord (1 appel), puis demande eBay,
 * et seulement ensuite les frais de port (les appels les plus chers).
 */
export async function analyzeCatalogProduct(
  token: string,
  marketId: MarketplaceId,
  productId: string,
  keyword: string,
  fallbackTitle: string | null,
  o: AnalyzeOptions,
): Promise<Analysis> {
  const m = marketplace(marketId);
  const toMarket = async (offers: SupplierOffer[]) => (m.currency === "USD" ? offers : offersToCurrency(offers, m.currency, await getUsdRates()));
  const product = await cj.getProduct(token, productId);
  const image = cj.productImages(product)[0] ?? null;
  const title = product.productNameEn || fallbackTitle;
  const empty = { variantId: null, marketPrice: null, cost: null, profit: null, marginPct: null, unitsSold: 0, deliveryDaysMax: null };
  const base = { title: title?.slice(0, 300) ?? null, image };
  const stocked = product.variants
    .map((v) => ({ v, stock: v.inventories?.find((i) => i.countryCode === m.country)?.totalInventory ?? 0 }))
    .filter((x) => x.stock > 0)
    .sort((a, b) => Number(a.v.variantSellPrice) - Number(b.v.variantSellPrice));
  if (!stocked.length) return { ...base, ...empty, status: "REJECTED", reason: "NO_SUPPLIER", details: {} };
  // Prix fournisseur (sans la livraison) dans la devise du pays, connu même quand le produit est rejeté plus loin.
  const [cheapest] = await toMarket([{ supplier: "CJ", productId: product.pid, variantId: stocked[0].v.vid, title: title ?? "", price: Number(stocked[0].v.variantSellPrice), shipping: 0, stockUs: stocked[0].stock, deliveryDaysMax: 0 }]);
  const supplierInfo: CandidateDetails = { supplierPrice: cheapest.price, stock: stocked[0].stock };

  const market = await searchWithDemand(keyword, 10, m.id);
  const insights = marketInsights(market);
  const sold = weightedMedian(market.soldWeighted);
  const prices = sold !== null ? [sold] : market.prices;
  // Pas d'annonce comparable ou pas de ventes : inutile d'interroger les frais de port.
  if (!prices.length) {
    return { ...base, ...empty, status: "REJECTED", reason: "NO_PRICE", unitsSold: market.unitsSold, details: { ...supplierInfo, market: insights } };
  }
  if (market.unitsSold < MIN_UNITS_SOLD) {
    const e = evaluateProduct(prices, [cheapest], o.minMarginPct, { market: m });
    return {
      ...base, ...empty, status: "REJECTED", reason: "NO_DEMAND", marketPrice: e.marketPrice, unitsSold: market.unitsSold,
      details: { ...supplierInfo, market: insights, fees: e.margin?.fees ?? null },
    };
  }
  const offers = await toMarket(await cjOffersFor(token, product, m.country));
  const e = evaluateProduct(prices, offers, o.minMarginPct, { market: m });
  const k = classify(e, { unitsSold: market.unitsSold, priceMin: o.priceMin, priceMax: o.priceMax, title, minProfit: o.minProfit });
  return {
    ...base,
    status: k.status,
    reason: k.reason ?? null,
    variantId: e.best?.variantId ?? null,
    marketPrice: e.marketPrice,
    cost: e.margin?.landedCost ?? null,
    profit: e.margin?.profit ?? null,
    marginPct: e.margin?.marginPct ?? null,
    unitsSold: market.unitsSold,
    deliveryDaysMax: e.best?.deliveryDaysMax ?? null,
    details: {
      market: insights,
      supplierPrice: e.best?.price ?? supplierInfo.supplierPrice,
      shipping: e.best?.shipping ?? null,
      fees: e.margin?.fees ?? null,
      stock: e.best?.stockUs ?? supplierInfo.stock,
      minPrice: e.minPriceForTarget,
    },
  };
}

/** Enregistre (ou rafraîchit) l'analyse d'un produit dans la base commune. */
export async function savePool(marketId: MarketplaceId, productId: string, keyword: string, a: Analysis) {
  // Seuls les rejets valables pour tout le monde sont gardés comme rejet ; une marge trop faible pour un vendeur
  // peut suffire à un autre (le filtre de marge est appliqué à la lecture).
  const reason = a.reason && HARD_REJECTS.has(a.reason) ? a.reason : null;
  const data = {
    keyword,
    variantId: a.variantId,
    title: a.title,
    image: a.image,
    reason,
    marketPrice: a.marketPrice,
    cost: a.cost,
    profit: a.profit,
    marginPct: a.marginPct,
    unitsSold: a.unitsSold,
    deliveryDaysMax: a.deliveryDaysMax,
    details: a.details as unknown as Prisma.InputJsonValue,
    analyzedAt: new Date(),
  };
  await db.productInsight.upsert({
    where: { marketplace_supplier_productId: { marketplace: marketId, supplier: "CJ", productId } },
    create: { marketplace: marketId, supplier: "CJ", productId, ...data },
    update: data,
  });
}

/** Nombre de vendeurs différents ayant déjà reçu (Sniper, 14 j) ou mis en vente chacun de ces produits. */
export async function sellerCounts(productIds: string[], exceptUserId?: string): Promise<Map<string, number>> {
  const out = new Map<string, Set<string>>();
  if (!productIds.length) return new Map();
  const [offered, listed] = await Promise.all([
    db.snipeCandidate.findMany({
      where: { productId: { in: productIds }, status: { in: ["PROFITABLE", "LISTED"] }, createdAt: { gt: new Date(Date.now() - EXPOSURE_WINDOW_MS) } },
      select: { productId: true, run: { select: { userId: true } } },
    }),
    db.listing.findMany({
      where: { supplier: "CJ", supplierProductId: { in: productIds }, status: { in: ["ACTIVE", "PAUSED", "DRAFT"] } },
      select: { supplierProductId: true, userId: true },
    }),
  ]);
  const add = (pid: string | null, uid: string) => {
    if (!pid || uid === exceptUserId) return;
    if (!out.has(pid)) out.set(pid, new Set());
    out.get(pid)!.add(uid);
  };
  for (const o of offered) add(o.productId, o.run.userId);
  for (const l of listed) add(l.supplierProductId, l.userId);
  return new Map([...out].map(([k, v]) => [k, v.size]));
}

/** Titre comparable : sans ponctuation ni couleur (« …Throttle, Blue » et « …Throttle, Pink » = même produit). */
const COLORS =
  /\b(black|white|red|blue|pink|green|yellow|orange|purple|grey|gray|silver|gold|brown|beige|navy|khaki|rose|multicolor)\b/g;
export const normTitle = (t: string | null) =>
  (t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(COLORS, " ").replace(/\s+/g, " ").trim();
const sameTitle = (a: string | null, b: string | null) => Boolean(a && b) && normTitle(a) === normTitle(b);

/** Ordre propre à chaque vendeur (stable) : deux vendeurs ne reçoivent pas les produits dans le même ordre. */
function userOrder(userId: string, productId: string): number {
  let h = 2166136261;
  for (const ch of userId + ":" + productId) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) / 2 ** 32;
}

export interface PoolQuery {
  userId: string;
  marketId: MarketplaceId;
  minMarginPct: number;
  minProfit?: number | null;
  priceMin?: number | null;
  priceMax?: number | null;
  themes?: string[];       // thèmes choisis par le vendeur (filtre sur le titre / la recherche)
  exclude?: string[];      // produits déjà vus dans cette recherche ou déjà en vente chez lui
  limit: number;
}

/** Produits rentables de la base commune pour ce vendeur (les meilleurs, dans un ordre qui lui est propre). */
export async function pickFromPool(q: PoolQuery): Promise<ProductInsight[]> {
  const themes = (q.themes ?? []).map((t) => t.trim()).filter(Boolean);
  const rows = await db.productInsight.findMany({
    where: {
      marketplace: q.marketId,
      supplier: "CJ",
      reason: null,
      marginPct: { gte: q.minMarginPct },
      ...(q.minProfit != null ? { profit: { gte: q.minProfit } } : {}),
      unitsSold: { gte: MIN_UNITS_SOLD },
      analyzedAt: { gt: new Date(Date.now() - POOL_FRESH_MS) },
      ...(q.priceMin != null || q.priceMax != null ? { marketPrice: { ...(q.priceMin != null ? { gte: q.priceMin } : {}), ...(q.priceMax != null ? { lte: q.priceMax } : {}) } } : {}),
      ...(q.exclude?.length ? { productId: { notIn: q.exclude } } : {}),
      ...(themes.length ? { OR: themes.flatMap((t) => [{ title: { contains: t, mode: "insensitive" as const } }, { keyword: { contains: t, mode: "insensitive" as const } }]) } : {}),
    },
    orderBy: { profit: "desc" },
    take: Math.max(q.limit * 4, 40),
  });
  if (!rows.length) return [];
  const counts = await sellerCounts(rows.map((r) => r.productId), q.userId);
  return rows
    .filter((r) => (counts.get(r.productId) ?? 0) < MAX_SELLERS_PER_PRODUCT)
    // Règles de marque mises à jour depuis l'analyse : jamais de produit de marque ou d'imitation.
    .filter((r) => !findVeroBrand(r.title ?? ""))
    // Les plus rentables restent en tête, mais l'ordre varie d'un vendeur à l'autre à rentabilité proche.
    .map((r) => ({ r, score: (r.profit ?? 0) * (0.75 + 0.5 * userOrder(q.userId, r.productId)) }))
    .sort((a, b) => b.score - a.score)
    // Même produit proposé par plusieurs fiches CJ (même titre) : une seule fois.
    .filter((x, i, all) => all.findIndex((y) => sameTitle(y.r.title, x.r.title)) === i)
    .slice(0, q.limit)
    .map((x) => x.r);
}

/** Prix minimum pour la marge du vendeur (la base garde celui calculé à la marge par défaut). */
export function minPriceFor(row: Pick<ProductInsight, "cost">, minMarginPct: number, marketId: MarketplaceId): number | null {
  if (row.cost == null) return null;
  try {
    return priceForTargetMargin(row.cost, minMarginPct, { market: marketplace(marketId) });
  } catch {
    return null;
  }
}

/* ---------- Scanner de fond (tâche planifiée) ---------- */

/** Jeton CJ utilisé par le scanner : celui du premier administrateur qui a connecté CJ. */
async function scannerToken(): Promise<string | null> {
  const admins = parseAdminEmails(process.env.ADMIN_EMAILS);
  if (!admins.length) return null;
  const acc = await db.supplierAccount.findFirst({
    where: { supplier: "CJ", user: { email: { in: admins, mode: "insensitive" } } },
    orderBy: { createdAt: "asc" },
    select: { accessToken: true },
  });
  return acc ? decrypt(acc.accessToken) : null;
}

interface CjListItem { id?: string; pid?: string; nameEn?: string; productNameEn?: string; productName?: string }
const MAX_ROUNDS = 30;

/**
 * Un passage du scanner : parcourt le catalogue (thème par thème, page par page) et analyse les produits
 * pas encore connus ou périmés, jusqu'à `deadline`. Réanalyse ensuite les produits rentables les plus anciens.
 */
export async function scanTick(
  marketId: MarketplaceId,
  deadline: number,
  opts: { seeds?: string[]; cursorKey?: string; refresh?: boolean } = {},
): Promise<{ analyzed: number; refreshed: number; skipped?: string }> {
  const seeds = opts.seeds?.length ? opts.seeds : DEFAULT_SEEDS;
  const token = await scannerToken();
  if (!token) return { analyzed: 0, refreshed: 0, skipped: "NO_CJ_ACCOUNT" };
  const m = marketplace(marketId);
  let analyzed = 0;
  let refreshed = 0;
  let errors = 0;

  const one = async (productId: string, keyword: string, title: string | null) => {
    try {
      const a = await analyzeCatalogProduct(token, m.id, productId, keyword, title, { minMarginPct: DEFAULT_MIN_MARGIN_PCT });
      await savePool(m.id, productId, keyword, a);
      errors = 0;
      return true;
    } catch (e) {
      console.error("Scanner", productId, e);
      errors++;
      return false;
    }
  };

  // 1) Nouveaux produits du catalogue.
  while (Date.now() < deadline - 20_000 && errors < 5) {
    const key = opts.cursorKey ?? m.id;
    const cur = (await db.scanCursor.findUnique({ where: { marketplace: key } })) ?? { seed: 0, round: 1 };
    const seed = seeds[cur.seed % seeds.length];
    const data = (await cj.searchProducts(token, seed, cur.round, 20, m.country)) as { content?: { productList?: CjListItem[] }[]; list?: CjListItem[] };
    const items = (data.content?.[0]?.productList ?? data.list ?? []).filter((it) => it.id ?? it.pid);
    // Thème suivant ; après le dernier thème, page suivante de chacun (on recommence au début après MAX_ROUNDS pages).
    const last = cur.seed + 1 >= seeds.length;
    const next = { seed: last ? 0 : cur.seed + 1, round: last ? (cur.round >= MAX_ROUNDS ? 1 : cur.round + 1) : cur.round };
    await db.scanCursor.upsert({ where: { marketplace: key }, create: { marketplace: key, ...next }, update: next });

    const ids = items.map((it) => String(it.id ?? it.pid));
    const known = await db.productInsight.findMany({
      where: { marketplace: m.id, supplier: "CJ", productId: { in: ids }, analyzedAt: { gt: new Date(Date.now() - POOL_REFRESH_MS) } },
      select: { productId: true },
    });
    const skip = new Set(known.map((k) => k.productId));
    for (const it of items) {
      if (Date.now() > deadline - 20_000 || errors >= 5) break;
      const pid = String(it.id ?? it.pid);
      if (skip.has(pid)) continue;
      const title = it.nameEn ?? it.productNameEn ?? it.productName ?? "";
      const keyword = keywordFromTitle(title);
      if (!keyword) continue;
      if (await one(pid, keyword, title)) analyzed++;
    }
    if (!items.length && cur.round > 1) continue; // page vide : on passe au thème suivant
  }

  if (opts.refresh === false) return { analyzed, refreshed };
  // 2) Produits rentables dont l'analyse vieillit : réanalysés en priorité (ce sont ceux qu'on propose).
  const stale = await db.productInsight.findMany({
    where: { marketplace: m.id, supplier: "CJ", reason: null, analyzedAt: { lt: new Date(Date.now() - POOL_REFRESH_MS) } },
    orderBy: { analyzedAt: "asc" },
    take: 50,
    select: { productId: true, keyword: true, title: true },
  });
  for (const s of stale) {
    if (Date.now() > deadline - 10_000 || errors >= 5) break;
    if (await one(s.productId, s.keyword, s.title)) refreshed++;
  }
  return { analyzed, refreshed };
}

/** Meilleurs produits de la base pour la page « Produits gagnants » (avec la même limite de vendeurs). */
export async function poolWinners(userId: string, marketId: MarketplaceId, minMarginPct: number, limit = 24, minProfit?: number | null) {
  const listed = await db.listing.findMany({ where: { userId, supplier: "CJ", status: { in: ["ACTIVE", "PAUSED", "DRAFT"] } }, select: { supplierProductId: true } });
  return pickFromPool({ userId, marketId, minMarginPct, minProfit, exclude: listed.map((l) => l.supplierProductId), limit });
}

/** Statistiques de la base (admin et page gagnants). */
export async function poolStats(marketId: MarketplaceId) {
  const fresh = new Date(Date.now() - POOL_FRESH_MS);
  const [total, profitable] = await Promise.all([
    db.productInsight.count({ where: { marketplace: marketId, analyzedAt: { gt: fresh } } }),
    db.productInsight.count({ where: { marketplace: marketId, analyzedAt: { gt: fresh }, reason: null, marginPct: { gte: DEFAULT_MIN_MARGIN_PCT }, unitsSold: { gte: MIN_UNITS_SOLD } } }),
  ]);
  return { total, profitable };
}
