/**
 * Recherche marché (côté serveur) : appels eBay (API Browse officielle) + cache en base.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import * as ebay from "@/lib/ebay";
import { marketplace, MARKETPLACE_IDS, type MarketplaceId } from "@/lib/marketplaces";
import { sellerReport, suggestTitle, titleKeywords, TREND_NICHES, type KeywordStat, type SellerReport, type SoldItem } from "@/lib/research";

const CACHE_MS = 12 * 3600_000;

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = await db.researchCache.findUnique({ where: { key } });
  if (hit && Date.now() - hit.createdAt.getTime() < CACHE_MS) return hit.data as unknown as T;
  const data = await load();
  const json = data as unknown as Prisma.InputJsonValue;
  await db.researchCache.upsert({ where: { key }, create: { key, data: json }, update: { data: json, createdAt: new Date() } });
  return data;
}

/**
 * Grandes catégories eBay parcourues pour retrouver les annonces d'un vendeur
 * (l'API Browse exige un mot-clé ou une catégorie). Les numéros sont communs à la plupart des sites eBay ;
 * une catégorie absente d'un pays est simplement ignorée.
 */
const SELLER_SCAN_CATEGORIES = [
  "11700", "26395", "1281", "888", "220", "15032", "293", "58058", "11450", "281",
  "2984", "14339", "12576", "625", "3252", "619", "6028", "131090", "267", "1249",
];
const MAX_SELLER_ITEMS = 400;
const MAX_SOLD_LOOKUPS = 200;

async function withSold(items: ebay.BrowseItem[], marketId: MarketplaceId, max: number): Promise<SoldItem[]> {
  const sample = items.slice(0, max);
  const sold = await ebay.soldQuantities(sample.map((i) => i.id), marketId);
  return sample
    .filter((i) => sold.has(i.id))
    .map((i) => ({ id: i.id, title: i.title, price: i.price, sold: sold.get(i.id)!, url: i.url, image: i.image, categoryId: i.categoryId }));
}

export interface SellerAnalysis extends SellerReport {
  username: string;
  marketId: MarketplaceId;
  keyword: string | null;
  feedbackScore: number | null;
  feedbackPercentage: number | null;
  currency: string;
  analyzedAt: string;
}

/** Espion de concurrents : annonces actives d'un vendeur, ventes estimées, chiffre d'affaires, meilleures ventes. */
export async function analyzeSeller(username: string, marketId: MarketplaceId, keyword?: string | null): Promise<SellerAnalysis> {
  const m = marketplace(marketId);
  const kw = keyword?.trim() || null;
  return cached(`seller:${m.id}:${username}:${kw ?? ""}`, async () => {
    const seen = new Map<string, ebay.BrowseItem>();
    let total = 0;
    if (kw) {
      for (let offset = 0; offset < MAX_SELLER_ITEMS; offset += 200) {
        const r = await ebay.browseSearch({ q: kw, seller: username, limit: 200, offset, newOnly: false }, m.id);
        total = r.total;
        r.items.forEach((i) => seen.set(i.id, i));
        if (r.items.length < 200) break;
      }
    } else {
      for (let i = 0; i < SELLER_SCAN_CATEGORIES.length && seen.size < MAX_SELLER_ITEMS; i += 5) {
        const batch = await Promise.all(
          SELLER_SCAN_CATEGORIES.slice(i, i + 5).map((categoryId) =>
            ebay.browseSearch({ categoryId, seller: username, limit: 200, newOnly: false }, m.id).catch(() => ({ total: 0, items: [] as ebay.BrowseItem[] })),
          ),
        );
        for (const r of batch) {
          total += r.total;
          r.items.forEach((it) => seen.set(it.id, it));
        }
      }
    }
    const items = [...seen.values()];
    const sellerInfo = items.find((i) => i.seller)?.seller;
    const sold = await withSold(items, m.id, MAX_SOLD_LOOKUPS);
    return {
      ...sellerReport(sold, total),
      username,
      marketId: m.id,
      keyword: kw,
      feedbackScore: sellerInfo?.feedbackScore ?? null,
      feedbackPercentage: sellerInfo?.feedbackPercentage ?? null,
      currency: m.currency,
      analyzedAt: new Date().toISOString(),
    };
  });
}

export interface TitleAnalysis {
  keyword: string;
  marketId: MarketplaceId;
  keywords: KeywordStat[];
  suggestion: string;
  topTitles: { title: string; sold: number; price: number; url?: string }[];
  listingsAnalyzed: number;
  unitsSold: number;
  currency: string;
}

/** Title Builder : mots des titres qui vendent vraiment pour une recherche. */
export async function analyzeTitles(keyword: string, marketId: MarketplaceId): Promise<TitleAnalysis> {
  const m = marketplace(marketId);
  const kw = keyword.trim().toLowerCase();
  return cached(`title:${m.id}:${kw}`, async () => {
    const r = await ebay.browseSearch({ q: kw, limit: 100 }, m.id);
    const sold = await withSold(r.items, m.id, 60);
    const keywords = titleKeywords(sold, 40);
    return {
      keyword: kw,
      marketId: m.id,
      keywords,
      suggestion: suggestTitle(keywords),
      topTitles: [...sold].sort((a, b) => b.sold - a.sold).slice(0, 10).map((i) => ({ title: i.title, sold: i.sold, price: i.price, url: i.url })),
      listingsAnalyzed: sold.length,
      unitsSold: sold.reduce((s, i) => s + i.sold, 0),
      currency: m.currency,
    };
  });
}

/* ---------- Meilleures ventes (tâche planifiée quotidienne) ---------- */

const TREND_PER_NICHE = 12;

/** Pays à relever : ceux des clients actifs (et toujours les États-Unis). */
export async function trendMarkets(): Promise<MarketplaceId[]> {
  const users = await db.user.findMany({ where: { plan: { not: "NONE" } }, select: { defaultMarketplace: true } });
  const set = new Set<MarketplaceId>(["EBAY_US"]);
  for (const u of users) set.add(marketplace(u.defaultMarketplace).id);
  return MARKETPLACE_IDS.filter((id) => set.has(id));
}

/** Relève les meilleures ventes d'un pays, niche par niche. Renvoie le nombre d'annonces enregistrées. */
export async function refreshTrends(marketId: MarketplaceId, deadline: number): Promise<number> {
  const m = marketplace(marketId);
  let saved = 0;
  for (const niche of TREND_NICHES) {
    if (Date.now() > deadline) break;
    try {
      const cat = await ebay.suggestCategory(niche, m.id);
      if (!cat) continue;
      const r = await ebay.browseSearch({ categoryId: cat.id, limit: 50 }, m.id);
      const sold = (await withSold(r.items, m.id, 50)).sort((a, b) => b.sold - a.sold).slice(0, TREND_PER_NICHE);
      const previous = await db.trendItem.findMany({ where: { marketplace: m.id, itemId: { in: sold.map((s) => s.id) } }, select: { itemId: true, sold: true, updatedAt: true } });
      const prev = new Map(previous.map((p) => [p.itemId, p]));
      for (const it of sold) {
        const before = prev.get(it.id);
        // La référence « veille » n'avance qu'une fois par jour (plusieurs passages le même jour ne l'écrasent pas).
        const soldPrev = before ? (Date.now() - before.updatedAt.getTime() > 20 * 3600_000 ? before.sold : undefined) : null;
        const data = {
          niche, categoryId: cat.id, categoryName: cat.name, title: it.title.slice(0, 300), image: it.image ?? null, url: it.url ?? null,
          price: it.price, currency: m.currency, sold: it.sold,
        };
        await db.trendItem.upsert({
          where: { marketplace_itemId: { marketplace: m.id, itemId: it.id } },
          create: { marketplace: m.id, itemId: it.id, ...data, soldPrev: null },
          update: { ...data, ...(soldPrev !== undefined ? { soldPrev } : {}) },
        });
        saved++;
      }
    } catch (e) {
      console.error("Tendances", m.id, niche, e);
    }
  }
  // Annonces qui ne sont plus dans les meilleures ventes depuis 3 jours : retirées de la liste.
  await db.trendItem.deleteMany({ where: { marketplace: m.id, updatedAt: { lt: new Date(Date.now() - 3 * 86_400_000) } } });
  return saved;
}

export interface TrendRow {
  itemId: string;
  niche: string;
  categoryName: string | null;
  title: string;
  image: string | null;
  url: string | null;
  price: number;
  currency: string;
  sold: number;
  daySales: number | null;
}

/** Meilleures ventes d'un pays (ventes du jour d'abord, puis ventes cumulées). */
export async function getTrends(marketId: MarketplaceId, opts: { niche?: string; limit?: number } = {}): Promise<TrendRow[]> {
  const rows = await db.trendItem.findMany({ where: { marketplace: marketId, ...(opts.niche ? { niche: opts.niche } : {}) } });
  return rows
    .map((r) => ({
      itemId: r.itemId, niche: r.niche, categoryName: r.categoryName, title: r.title, image: r.image, url: r.url,
      price: r.price, currency: r.currency, sold: r.sold, daySales: r.soldPrev === null ? null : Math.max(0, r.sold - r.soldPrev),
    }))
    .sort((a, b) => (b.daySales ?? -1) - (a.daySales ?? -1) || b.sold - a.sold)
    .slice(0, opts.limit ?? 60);
}
