/**
 * Chercheur de produits : prix du marché eBay US vs meilleures offres fournisseurs.
 * NB : en attendant une source de prix « vendus », on utilise la médiane des annonces actives
 * neuves (API Browse). À remplacer dès que la source des ventes réelles est choisie.
 */
import { evaluateProduct, type Evaluation, type SupplierOffer } from "@/lib/margin";
import { searchActive } from "@/lib/ebay";
import * as cj from "@/lib/suppliers/cj";

export interface FinderResult extends Evaluation {
  keyword: string;
  ebayListingsCount: number;
  offersChecked: number;
  priceSource: "ACTIVE_LISTINGS";
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
  const market = await searchActive(keyword, 50);
  const offers: SupplierOffer[] = [...(opts.extraOffers ?? [])];
  if (opts.cjToken) offers.push(...(await cjOffers(opts.cjToken, keyword)));
  const evaluation = evaluateProduct(market.prices, offers, opts.minMarginPct);
  return {
    ...evaluation,
    keyword,
    ebayListingsCount: market.total,
    offersChecked: offers.length,
    priceSource: "ACTIVE_LISTINGS",
  };
}
