/**
 * Recherche marché (côté serveur) : appels eBay (API Browse officielle) + cache en base.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import * as ebay from "@/lib/ebay";
import { marketplace, MARKETPLACE_IDS, type MarketplaceId } from "@/lib/marketplaces";
import { suggestTitle, titleKeywords, type KeywordStat, type SoldItem } from "@/lib/research";

/** Infos d'annonces eBay affichées : jamais plus de 6 h de retard sur eBay (contrat de licence API eBay). */
const CACHE_MS = 6 * 3600_000;

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = await db.researchCache.findUnique({ where: { key } });
  if (hit && Date.now() - hit.createdAt.getTime() < CACHE_MS) return hit.data as unknown as T;
  const data = await load();
  const json = data as unknown as Prisma.InputJsonValue;
  await db.researchCache.upsert({ where: { key }, create: { key, data: json }, update: { data: json, createdAt: new Date() } });
  return data;
}

async function withSold(items: ebay.BrowseItem[], marketId: MarketplaceId, max: number): Promise<SoldItem[]> {
  const sample = items.slice(0, max);
  const sold = await ebay.soldQuantities(sample.map((i) => i.id), marketId);
  return sample
    .filter((i) => sold.has(i.id))
    .map((i) => ({ id: i.id, title: i.title, price: i.price, sold: sold.get(i.id)!, url: i.url, image: i.image, categoryId: i.categoryId }));
}

export interface TitleAnalysis {
  keyword: string;
  marketId: MarketplaceId;
  keywords: KeywordStat[];
  suggestion: string;
  topTitles: { title: string; sold: number; price: number; url?: string }[];
  listingsAnalyzed: number;
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
      currency: m.currency,
    };
  });
}

/* ---------- Pays des clients (scanner de produits) ---------- */

/** Pays à relever : ceux des clients actifs (et toujours les États-Unis). */
export async function trendMarkets(): Promise<MarketplaceId[]> {
  const users = await db.user.findMany({ where: { plan: { not: "NONE" } }, select: { defaultMarketplace: true } });
  const set = new Set<MarketplaceId>(["EBAY_US"]);
  for (const u of users) set.add(marketplace(u.defaultMarketplace).id);
  return MARKETPLACE_IDS.filter((id) => set.has(id));
}
