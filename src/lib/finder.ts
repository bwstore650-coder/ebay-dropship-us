/**
 * Chercheur de produits : prix du marché eBay vs meilleures offres fournisseurs, pour un pays donné.
 * Source des prix (100 % API officielle eBay) :
 *   1. médiane des prix pondérée par les ventes estimées de chaque annonce (Browse getItem) ;
 *   2. à défaut de ventes, médiane des annonces actives neuves.
 * Quand l'accès Marketplace Insights (ventes réelles 90 jours) sera accordé, il passera en priorité.
 */
import { evaluateProduct, weightedMedian, type Evaluation, type SupplierOffer } from "@/lib/margin";
import { searchWithDemand } from "@/lib/ebay";
import { marketplace, type MarketplaceId } from "@/lib/marketplaces";
import * as cj from "@/lib/suppliers/cj";
import { getUsdRates, offersToCurrency } from "@/lib/fx";
import { marketInsights, type MarketInsights } from "@/lib/market-insights";

export interface FinderResult extends Evaluation {
  keyword: string;
  marketId: MarketplaceId;
  currency: string;
  symbol: string;
  feesVerified: boolean;
  ebayListingsCount: number;
  offersChecked: number;
  unitsSold: number;
  priceSource: "SOLD_WEIGHTED" | "ACTIVE_LISTINGS";
  insights: MarketInsights; // fourchette de prix, ventes par mois, meilleurs concurrents
}

interface CjListV2Item { id?: string; pid?: string }

async function cjOffers(token: string, keyword: string, country: string, maxProducts = 3): Promise<SupplierOffer[]> {
  const list = (await cj.searchProducts(token, keyword, 1, maxProducts, country)) as {
    content?: { productList?: CjListV2Item[] }[];
    list?: CjListV2Item[];
  };
  const items = list.content?.[0]?.productList ?? list.list ?? [];
  const offers: SupplierOffer[] = [];
  for (const it of items.slice(0, maxProducts)) {
    const pid = it.id ?? it.pid;
    if (!pid) continue;
    const product = await cj.getProduct(token, pid);
    offers.push(...(await cj.toOffers(token, product, country)));
  }
  return offers;
}

export async function findProduct(
  keyword: string,
  opts: { cjToken?: string; minMarginPct: number; marketId?: MarketplaceId; extraOffers?: SupplierOffer[] },
): Promise<FinderResult> {
  const m = marketplace(opts.marketId);
  const market = await searchWithDemand(keyword, 20, m.id);
  const soldPrice = weightedMedian(market.soldWeighted);
  // Offres fournisseurs en USD → converties dans la devise du pays avant toute comparaison.
  const usdOffers: SupplierOffer[] = [...(opts.extraOffers ?? [])];
  if (opts.cjToken) usdOffers.push(...(await cjOffers(opts.cjToken, keyword, m.country)));
  const offers = m.currency === "USD" ? usdOffers : offersToCurrency(usdOffers, m.currency, await getUsdRates());
  const evaluation = evaluateProduct(soldPrice !== null ? [soldPrice] : market.prices, offers, opts.minMarginPct, { market: m });
  return {
    ...evaluation,
    keyword,
    marketId: m.id,
    currency: m.currency,
    symbol: m.symbol,
    feesVerified: m.verified,
    ebayListingsCount: market.total,
    offersChecked: offers.length,
    unitsSold: market.unitsSold,
    priceSource: soldPrice !== null ? "SOLD_WEIGHTED" : "ACTIVE_LISTINGS",
    insights: marketInsights(market),
  };
}
