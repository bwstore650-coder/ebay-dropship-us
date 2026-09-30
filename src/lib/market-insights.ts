/**
 * Analyse d'un marché eBay pour un produit : fourchette de prix, ventes estimées par mois, meilleurs concurrents.
 * Fonctions pures (testées) ; les données viennent de l'API officielle eBay (annonces actives + ventes estimées).
 */
import { median } from "@/lib/margin";

export interface AnalyzedListing {
  title: string;
  price: number;
  sold: number;
  url?: string;
  image?: string;
  createdAt?: string;
}

export interface MarketInsights {
  listings: number;            // annonces actives trouvées sur eBay
  analyzed: number;            // annonces dont les ventes ont été lues
  prices: number[];            // prix des concurrents (triés), pour le graphique
  priceMin: number | null;
  priceMedian: number | null;
  priceMax: number | null;
  soldTotal: number;           // ventes cumulées des annonces analysées (estimation eBay)
  monthlySales: number | null; // ventes estimées par mois sur ce marché
  top: { title: string; price: number; sold: number; url?: string }[];
}

export const MAX_CHART_PRICES = 40;
const DAY_MS = 86_400_000;
const MONTH_DAYS = 30.44;

/**
 * Ventes par mois : pour chaque annonce, ventes cumulées ÷ mois écoulés depuis sa mise en ligne (au moins un mois).
 * null si eBay ne donne la date d'aucune annonce.
 */
export function monthlySalesEstimate(items: AnalyzedListing[], now = new Date()): number | null {
  let total = 0;
  let dated = 0;
  for (const i of items) {
    const created = i.createdAt ? Date.parse(i.createdAt) : NaN;
    if (!Number.isFinite(created)) continue;
    dated++;
    const months = Math.max(1, (now.getTime() - created) / DAY_MS / MONTH_DAYS);
    total += i.sold / months;
  }
  return dated ? Math.round(total * 10) / 10 : null;
}

export function marketInsights(
  m: { total: number; prices: number[]; analyzed: AnalyzedListing[] },
  now = new Date(),
): MarketInsights {
  const prices = m.prices.filter((p) => p > 0).sort((a, b) => a - b);
  // Pour le graphique : échantillon réparti sur toute la fourchette.
  const step = prices.length > MAX_CHART_PRICES ? prices.length / MAX_CHART_PRICES : 1;
  const chart = prices.length > MAX_CHART_PRICES ? Array.from({ length: MAX_CHART_PRICES }, (_, i) => prices[Math.floor(i * step)]) : prices;
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    listings: m.total,
    analyzed: m.analyzed.length,
    prices: chart.map(round),
    priceMin: prices.length ? round(prices[0]) : null,
    priceMedian: prices.length ? round(median(prices)!) : null,
    priceMax: prices.length ? round(prices[prices.length - 1]) : null,
    soldTotal: m.analyzed.reduce((s, i) => s + i.sold, 0),
    monthlySales: monthlySalesEstimate(m.analyzed, now),
    top: [...m.analyzed]
      .filter((i) => i.sold > 0)
      .sort((a, b) => b.sold - a.sold)
      .slice(0, 3)
      .map((i) => ({ title: i.title.slice(0, 120), price: round(i.price), sold: i.sold, url: i.url })),
  };
}
