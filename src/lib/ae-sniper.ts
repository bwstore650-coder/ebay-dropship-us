/**
 * Sniper AliExpress « eBay d'abord » : économise le quota eBay.
 *
 * 1. Une recherche eBay par thème (1 appel = jusqu'à 200 annonces : prix, photo, titre). Les annonces du même
 *    produit sont regroupées.
 * 2. Chaque groupe est cherché chez AliExpress par la PHOTO de l'annonce eBay (mots-clés en secours) — aucun
 *    appel eBay. On garde le produit seulement s'il est expédié d'un entrepôt du pays et rentable au prix eBay.
 * 3. Seulement pour ces produits-là : ventes estimées de quelques annonces du groupe (quelques appels eBay).
 */
import type { CandidateDetails } from "@/lib/sniper";
import { classify, inCostRange, keywordFromTitle, MAX_VARIANTS } from "@/lib/sniper";
import { titleWords, monthlySales } from "@/lib/comparables";
import { findVeroBrand } from "@/lib/compliance";
import * as ebay from "@/lib/ebay";
import { imageBase64 } from "@/lib/ebay-quota";
import { getUsdRates, offersToCurrency } from "@/lib/fx";
import { evaluateProduct, median, weightedMedian, type Evaluation, type SupplierOffer } from "@/lib/margin";
import { marketInsights } from "@/lib/market-insights";
import { marketplace, type MarketplaceId } from "@/lib/marketplaces";
import type { Analysis, AnalyzeOptions } from "@/lib/product-pool";
import * as ae from "@/lib/suppliers/aliexpress";

/** Annonces eBay d'un même produit (trouvées par la recherche du thème). */
export type EbayGroup = NonNullable<CandidateDetails["ebayGroup"]>;

/** Annonces dont on lit les ventes, par produit (le seul poste qui coûte des appels eBay). */
export const SALES_SAMPLE = 5;
/** Produits AliExpress essayés par groupe (les plus ressemblants). */
const MAX_MATCHES = 3;
/** Ressemblance minimum de la photo AliExpress (0 à 1). */
export const MIN_SIMILARITY = 0.6;
/** Mots en commun minimum (part des mots du titre eBay) quand on cherche par mots-clés. */
const MIN_WORD_OVERLAP = 0.3;

/** Part des mots de `a` présents dans `b`. */
export function wordOverlap(a: string, b: string): number {
  const wa = titleWords(a);
  if (!wa.length) return 0;
  const wb = new Set(titleWords(b));
  return wa.filter((w) => wb.has(w)).length / wa.length;
}

/** Regroupe les annonces du même produit (titres très proches ou même photo). L'ordre de la recherche est gardé. */
export function groupListings(items: ebay.MarketSnapshot["items"]): EbayGroup[] {
  const groups: { lead: ebay.MarketSnapshot["items"][number]; items: ebay.MarketSnapshot["items"] }[] = [];
  for (const it of items) {
    if (!(it.price > 0)) continue;
    const g = groups.find((x) => (it.image && x.lead.image === it.image) || jaccard(x.lead.title, it.title) >= 0.6);
    if (g) g.items.push(it);
    else groups.push({ lead: it, items: [it] });
  }
  return groups.map(({ lead, items: list }) => {
    const prices = list.map((i) => i.price).sort((a, b) => a - b);
    return {
      title: lead.title,
      image: lead.image ?? null,
      price: Math.round((median(prices) ?? lead.price) * 100) / 100,
      prices,
      itemIds: list.slice(0, SALES_SAMPLE).map((i) => i.id),
      createdAt: list.slice(0, SALES_SAMPLE).map((i) => i.createdAt ?? null),
      total: list.length,
    };
  });
}

function jaccard(a: string, b: string): number {
  const wa = new Set(titleWords(a));
  const wb = new Set(titleWords(b));
  if (!wa.size || !wb.size) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / (wa.size + wb.size - inter);
}

/** Groupes à analyser : sans marque protégée et avec un mot-clé exploitable. */
export function usableGroups(groups: EbayGroup[]): EbayGroup[] {
  return groups.filter((g) => !findVeroBrand(g.title) && keywordFromTitle(g.title));
}

type AeSession = { cfg: ae.AeConfig; session: string };

/** Produits AliExpress correspondants (photo d'abord, mots-clés en secours), expédiés depuis le pays si connu. */
async function matchesFor(s: AeSession, g: EbayGroup, country: string): Promise<string[]> {
  const b64 = g.image ? await imageBase64(g.image) : null;
  if (b64) {
    try {
      const found = await ae.imageSearch(s.cfg, s.session, { imageBase64: b64, country });
      const good = found.filter((m) => m.similarity >= MIN_SIMILARITY && (!m.shipFrom || m.shipFrom === country));
      if (good.length) return good.slice(0, MAX_MATCHES).map((m) => m.productId);
    } catch (e) {
      console.error("AliExpress recherche par photo", e);
    }
  }
  const kw = keywordFromTitle(g.title);
  if (!kw) return [];
  const items = await ae.textSearch(s.cfg, s.session, { keyword: kw, country, pageSize: 10 });
  return items.filter((it) => wordOverlap(g.title, it.title) >= MIN_WORD_OVERLAP).slice(0, MAX_MATCHES).map((it) => it.productId);
}

export interface EbayFirstResult { analysis: Analysis; productId: string | null }

/**
 * Analyse d'un groupe d'annonces eBay : fournisseur AliExpress (sans appel eBay), puis ventes seulement
 * si le produit est disponible dans le pays et rentable.
 */
export async function analyzeEbayGroup(s: AeSession, marketId: MarketplaceId, g: EbayGroup, o: AnalyzeOptions & { minMonthlySales?: number | null }): Promise<EbayFirstResult> {
  const m = marketplace(marketId);
  const toMarket = async (offers: SupplierOffer[]) => (m.currency === "USD" ? offers : offersToCurrency(offers, m.currency, await getUsdRates()));
  const keyword = keywordFromTitle(g.title);
  const empty = { variantId: null, cost: null, profit: null, marginPct: null, unitsSold: 0, deliveryDaysMax: null };
  const ebayOnly = { title: g.title.slice(0, 300), image: g.image, marketPrice: g.price, keyword };
  const details = (extra: CandidateDetails = {}): CandidateDetails => ({
    market: marketInsights({ total: g.total, prices: g.prices, analyzed: [], method: "KEYWORD" }),
    ...extra,
  });

  // 1. Fournisseur (aucun appel eBay).
  const ids = await matchesFor(s, g, m.country);
  let best: { e: Evaluation; p: ae.AeProduct; offers: SupplierOffer[] } | null = null;
  let cheapestSeen: number | null = null;
  for (const id of ids) {
    let p: ae.AeProduct;
    try {
      p = await ae.getProduct(s.cfg, s.session, id, m.country);
    } catch {
      continue;
    }
    const local = ae.localSkus(p, m.country);
    if (!local.length) continue;
    const [cheap] = await toMarket([{ supplier: "ALIEXPRESS", productId: p.productId, variantId: local[0].skuId, title: p.title, price: local[0].price, shipping: 0, stockUs: local[0].stock, deliveryDaysMax: 0 }]);
    cheapestSeen = cheapestSeen === null ? cheap.price : Math.min(cheapestSeen, cheap.price);
    if (!inCostRange(cheap.price, o.costMin, o.costMax)) continue;
    const offers = await toMarket(await ae.offersFromProduct(s.cfg, s.session, p, m.country, MAX_VARIANTS));
    if (!offers.length) continue;
    const e = evaluateProduct([g.price], offers, o.minMarginPct, { market: m });
    if (!best || (e.margin?.profit ?? -Infinity) > (best.e.margin?.profit ?? -Infinity)) best = { e, p, offers };
    if (e.verdict === "RENTABLE") break;
  }
  if (!best) {
    const reason = cheapestSeen !== null && (o.costMin != null || o.costMax != null) ? "COST_RANGE" : "NO_SUPPLIER";
    return { productId: null, analysis: { ...ebayOnly, ...empty, status: "REJECTED", reason, details: details(cheapestSeen !== null ? { supplierPrice: cheapestSeen } : {}) } };
  }
  const supplier = { title: best.p.title.slice(0, 300) || ebayOnly.title, image: best.p.images[0] ?? g.image };
  const pre = classify(best.e, { unitsSold: Number.MAX_SAFE_INTEGER, priceMin: o.priceMin, priceMax: o.priceMax, title: g.title, minProfit: o.minProfit, costMin: o.costMin, costMax: o.costMax });
  const offerDetails = (e: Evaluation): CandidateDetails => ({
    supplierPrice: e.best?.price ?? null, shipping: e.best?.shipping ?? null, fees: e.margin?.fees ?? null, stock: e.best?.stockUs ?? null, minPrice: e.minPriceForTarget,
  });
  if (pre.status !== "PROFITABLE") {
    return {
      productId: best.p.productId,
      analysis: {
        ...ebayOnly, ...supplier, status: "REJECTED", reason: pre.reason ?? "LOW_MARGIN", variantId: best.e.best?.variantId ?? null,
        cost: best.e.margin?.landedCost ?? null, profit: best.e.margin?.profit ?? null, marginPct: best.e.margin?.marginPct ?? null,
        unitsSold: 0, deliveryDaysMax: best.e.best?.deliveryDaysMax ?? null, details: details(offerDetails(best.e)),
      },
    };
  }

  // 2. Disponible et rentable : ventes estimées de quelques annonces du groupe (les seuls appels eBay ici).
  const sold = await ebay.soldQuantities(g.itemIds, marketId);
  const analyzed = g.itemIds
    .map((id, i) => ({ id, i }))
    .filter(({ id }) => sold.has(id))
    .map(({ id, i }) => ({ title: g.title, price: g.prices[Math.min(i, g.prices.length - 1)], sold: sold.get(id)!, createdAt: g.createdAt[i] ?? undefined }));
  const unitsSold = analyzed.reduce((t, a) => t + a.sold, 0);
  const monthly = monthlySales(analyzed);
  const soldPrice = weightedMedian(analyzed.map((a) => ({ price: a.price, weight: a.sold })));
  const e = evaluateProduct([soldPrice ?? g.price], best.offers, o.minMarginPct, { market: m });
  const k = classify(e, {
    unitsSold, priceMin: o.priceMin, priceMax: o.priceMax, title: g.title, minProfit: o.minProfit, costMin: o.costMin, costMax: o.costMax,
    monthlySales: monthly, minMonthlySales: o.minMonthlySales,
  });
  return {
    productId: best.p.productId,
    analysis: {
      ...ebayOnly, ...supplier,
      status: k.status, reason: k.reason ?? null,
      variantId: e.best?.variantId ?? null,
      marketPrice: e.marketPrice,
      cost: e.margin?.landedCost ?? null,
      profit: e.margin?.profit ?? null,
      marginPct: e.margin?.marginPct ?? null,
      unitsSold,
      deliveryDaysMax: e.best?.deliveryDaysMax ?? null,
      details: {
        market: marketInsights({ total: g.total, prices: g.prices, analyzed, monthlySales: monthly, method: "KEYWORD" }),
        ...offerDetails(e),
      },
    },
  };
}
