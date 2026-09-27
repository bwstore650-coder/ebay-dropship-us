/**
 * Chercheur de produits : prix du marché eBay US vs meilleures offres fournisseurs.
 * Source des prix (100 % API officielle eBay) :
 *   1. médiane des prix pondérée par les ventes estimées de chaque annonce (Browse getItem) ;
 *   2. à défaut de ventes, médiane des annonces actives neuves.
 * Quand l'accès Marketplace Insights (ventes réelles 90 jours) sera accordé, il passera en priorité.
 */
import { evaluateProduct, weightedMedian, type Evaluation, type SupplierOffer } from "@/lib/margin";
import { searchWithDemand } from "@/lib/ebay";
import * as cj from "@/lib/suppliers/cj";

export interface FinderResult extends Evaluation {
  keyword: string;
  ebayListingsCount: number;
  offersChecked: number;
  unitsSold: number;
  priceSource: "SOLD_WEIGHTED" | "ACTIVE_LISTINGS";
}

interface CjListV2Item { id?: string; pid?: string }

async function cjOffers(token: string, keyword: string, maxProducts = 3): Promise<SupplierOffer[]> {
  const list = (await cj.searchProducts(token, keyword, 1, maxProducts)) as {
    content?: { productList?: CjListV2Item[] }[];
    list?: CjListV2Item[];
  };
  const items = list.content?.[0]?.productList ?? list.list ?? [];
  const offers: SupplierOffer[] = [];
  for (const it of items.slice(0, maxProducts)) {
    const pid = it.id ?? it.pid;
    if (!pid) continue;
    const product = await cj.getProduct(token, pid);
    offers.push(...(await cj.toOffers(token, product)));
  }
  return offers;
}

export async function findProduct(
  keyword: string,
  opts: { cjToken?: string; minMarginPct: number; extraOffers?: SupplierOffer[] },
): Promise<FinderResult> {
  const market = await searchWithDemand(keyword, 20);
  const soldPrice = weightedMedian(market.soldWeighted);
  const offers: SupplierOffer[] = [...(opts.extraOffers ?? [])];
  if (opts.cjToken) offers.push(...(await cjOffers(opts.cjToken, keyword)));
  const evaluation = evaluateProduct(soldPrice !== null ? [soldPrice] : market.prices, offers, opts.minMarginPct);
  return {
    ...evaluation,
    keyword,
    ebayListingsCount: market.total,
    offersChecked: offers.length,
    unitsSold: market.unitsSold,
    priceSource: soldPrice !== null ? "SOLD_WEIGHTED" : "ACTIVE_LISTINGS",
  };
}
