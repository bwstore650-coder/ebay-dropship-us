/**
 * Marketplaces eBay prises en charge et leurs frais « catégories standard ».
 * `verified: true` = taux vérifiés sur la page officielle d'eBay du pays.
 * `verified: false` = taux de départ à confirmer sur la page officielle avant le lancement dans ce pays
 * (le client peut de toute façon ajuster le taux dans ses réglages et dans le calculateur).
 */

export type MarketplaceId = "EBAY_US" | "EBAY_CA" | "EBAY_GB" | "EBAY_AU";

export interface Marketplace {
  id: MarketplaceId;
  name: string;
  country: "US" | "CA" | "GB" | "AU";
  currency: "USD" | "CAD" | "GBP" | "AUD";
  symbol: string;
  language: string;          // en-tête Content-Language pour l'API Inventory
  fvfRate: number;           // commission sur le total de la vente
  perOrderFeeLow: number;    // frais fixe si total ≤ seuil
  perOrderFeeHigh: number;   // frais fixe si total > seuil
  perOrderThreshold: number;
  feeTaxRate: number;        // taxe ajoutée sur les frais eBay (TVA UK pour un vendeur non assujetti, etc.)
  verified: boolean;
  source: string;
}

export const MARKETPLACES: Record<MarketplaceId, Marketplace> = {
  EBAY_US: {
    id: "EBAY_US", name: "eBay États-Unis", country: "US", currency: "USD", symbol: "$", language: "en-US",
    fvfRate: 0.136, perOrderFeeLow: 0.3, perOrderFeeHigh: 0.4, perOrderThreshold: 10, feeTaxRate: 0,
    verified: true, source: "https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees",
  },
  EBAY_CA: {
    id: "EBAY_CA", name: "eBay Canada", country: "CA", currency: "CAD", symbol: "C$", language: "en-CA",
    fvfRate: 0.136, perOrderFeeLow: 0.3, perOrderFeeHigh: 0.4, perOrderThreshold: 10, feeTaxRate: 0,
    verified: true, source: "https://www.ebay.ca/sellercentre/selling/seller-fees",
  },
  EBAY_GB: {
    id: "EBAY_GB", name: "eBay Royaume-Uni", country: "GB", currency: "GBP", symbol: "£", language: "en-GB",
    // Frais fixe vérifié (0,30 £ / 0,40 £ au-dessus de 10 £, depuis le 12/02/2026) ; le taux varie selon la catégorie (≈ 9,9 % à 14,9 %) : 12,9 % par défaut, À CONFIRMER.
    fvfRate: 0.129, perOrderFeeLow: 0.3, perOrderFeeHigh: 0.4, perOrderThreshold: 10, feeTaxRate: 0.2,
    verified: false, source: "https://www.ebay.co.uk/sellercentre/news/2026-january/rate-card-change",
  },
  EBAY_AU: {
    id: "EBAY_AU", name: "eBay Australie", country: "AU", currency: "AUD", symbol: "A$", language: "en-AU",
    // 13,4 % jusqu'à 4 000 A$ + 0,30 A$ par commande : À CONFIRMER sur la page officielle eBay Australie.
    fvfRate: 0.134, perOrderFeeLow: 0.3, perOrderFeeHigh: 0.3, perOrderThreshold: 10, feeTaxRate: 0,
    verified: false, source: "https://www.ebay.com.au/help/selling/fees-credits-invoices/selling-fees",
  },
};

export const MARKETPLACE_IDS = Object.keys(MARKETPLACES) as MarketplaceId[];

export function marketplace(id: string | null | undefined): Marketplace {
  return MARKETPLACES[(id ?? "EBAY_US") as MarketplaceId] ?? MARKETPLACES.EBAY_US;
}
