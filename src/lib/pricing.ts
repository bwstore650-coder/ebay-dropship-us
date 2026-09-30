/**
 * Publicité automatique (Promoted Listings) et repricing face aux concurrents — fonctions pures, testées.
 * Règle d'or commune : la marge minimum du vendeur est toujours respectée.
 */
import { computeMargin, median, priceForTargetMargin } from "@/lib/margin";
import { marketplace } from "@/lib/marketplaces";
import { tokenize } from "@/lib/research";

/* ---------- Promoted Listings (coût par vente) ---------- */

/** Taux publicitaire minimum accepté par eBay (%). */
export const MIN_AD_RATE = 2;
export const MAX_AD_RATE = 20;

/**
 * Taux publicitaire le plus élevé qui garde la marge minimum, plafonné par le vendeur (arrondi à 0,1 %).
 * null si même le taux minimum d'eBay ferait passer sous la marge : l'annonce n'est pas promue.
 */
export function affordableAdRate(i: { price: number; cost: number; minMarginPct: number; marketId: string; cap: number }): number | null {
  const market = marketplace(i.marketId);
  const cap = Math.min(MAX_AD_RATE, Math.max(0, i.cap));
  for (let r = Math.floor(cap * 10); r >= MIN_AD_RATE * 10; r--) {
    const rate = r / 10;
    const m = computeMargin({ saleTotal: i.price, supplierCost: i.cost, market, promotedRate: rate / 100 });
    if (m.marginPct >= i.minMarginPct) return rate;
  }
  return null;
}

/** Faut-il changer l'enchère ? (évite des appels pour des écarts minimes) */
export function adRateChanged(current: number | null, next: number | null): boolean {
  if (current === null || next === null) return current !== next;
  return Math.abs(current - next) >= 0.5;
}

/* ---------- Repricing ---------- */

export const REPRICE_EVERY_MS = 6 * 3600_000;
/** Il faut au moins autant d'annonces comparables pour oser changer le prix. */
export const MIN_COMPETITORS = 3;

/** Annonce concurrente comparable : son titre reprend au moins la moitié des mots de notre recherche. */
export function isComparable(keyword: string, title: string): boolean {
  const k = new Set(tokenize(keyword));
  if (!k.size) return false;
  const t = new Set(tokenize(title));
  let hit = 0;
  for (const w of k) if (t.has(w)) hit++;
  return hit / k.size >= 0.5;
}

/** Prix des concurrents comparables, sans nous-mêmes ni les prix aberrants (moins de 60 % de la médiane). */
export function competitorPrices(keyword: string, items: { id: string; title: string; price: number }[], ownListingId: string | null): number[] {
  const mine = ownListingId ? `|${ownListingId}|` : null;
  const prices = items
    .filter((i) => i.price > 0 && !(mine && (i.id.includes(mine) || i.id === ownListingId)) && isComparable(keyword, i.title))
    .map((i) => i.price);
  const med = median(prices);
  return med === null ? [] : prices.filter((p) => p >= med * 0.6).sort((a, b) => a - b);
}

export interface RepriceInput {
  price: number;          // prix actuel
  basePrice: number;      // prix de départ (plafond = 1,5 ×)
  cost: number;           // coût livré actuel
  minMarginPct: number;
  marketId: string;
  competitors: number[];  // prix comparables, triés
  undercutPct: number;    // passer sous le moins cher de x %
}

/**
 * Nouveau prix : juste sous le concurrent le moins cher, jamais sous le prix minimum de marge,
 * jamais au-dessus de 1,5 × le prix de départ. null = ne rien changer.
 */
export function repriceTarget(i: RepriceInput): number | null {
  if (i.competitors.length < MIN_COMPETITORS) return null;
  const market = marketplace(i.marketId);
  const floor = priceForTargetMargin(i.cost, i.minMarginPct, { market });
  const ceiling = Math.max(floor, i.basePrice * 1.5);
  const lowest = i.competitors[0];
  let target = Math.floor(lowest * (1 - Math.max(0, Math.min(10, i.undercutPct)) / 100) * 100 + 1e-6) / 100;
  target = Math.min(ceiling, Math.max(floor, target));
  target = Math.round(target * 100) / 100;
  const diff = Math.abs(target - i.price);
  if (diff < 0.05 || diff / i.price < 0.01) return null;
  return target;
}
