/**
 * Analyse d'un marché eBay pour un produit : nombre d'annonces et fourchette de prix.
 * Pas de totaux de ventes agrégés ni de liste d'annonces gardée en base (contrat de licence API eBay).
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
}

export const MAX_CHART_PRICES = 40;

export function marketInsights(
  m: { total: number; prices: number[]; analyzed: AnalyzedListing[] },
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
  };
}
