/**
 * Marketplaces eBay prises en charge et leurs frais « catégories standard » pour les VENDEURS PROFESSIONNELS.
 * `verified: true`  = taux relevés sur la page officielle d'eBay du pays (lien dans `source`) le 27/09/2026.
 * `verified: false` = taux de départ à confirmer avant le lancement dans ce pays.
 * Les frais européens sont affichés HORS TVA par eBay : un vendeur assujetti récupère cette TVA (feeTaxRate = 0).
 * Les paliers au-delà de 990 € (taux réduit sur la partie haute) sont ignorés : produits visés < 990 €.
 */

export type MarketplaceId =
  | "EBAY_US" | "EBAY_CA" | "EBAY_GB" | "EBAY_AU"
  | "EBAY_DE" | "EBAY_FR" | "EBAY_IT" | "EBAY_ES" | "EBAY_IE";

export type CountryCode = "US" | "CA" | "GB" | "AU" | "DE" | "FR" | "IT" | "ES" | "IE";
export type CurrencyCode = "USD" | "CAD" | "GBP" | "AUD" | "EUR";

export interface Marketplace {
  id: MarketplaceId;
  country: CountryCode;
  currency: CurrencyCode;
  symbol: string;
  language: string;          // en-tête Content-Language (langue des annonces)
  listingLanguage: "en" | "de" | "fr" | "it" | "es";
  fvfRate: number;           // commission variable sur le total de la vente
  regulatoryRate: number;    // frais réglementaires (% du total), 0 si aucun
  perOrderFeeLow: number;    // frais fixe si total ≤ seuil
  perOrderFeeHigh: number;   // frais fixe si total > seuil
  perOrderThreshold: number;
  feeTaxRate: number;        // taxe ajoutée sur les frais eBay (0 = HT récupérable)
  verified: boolean;
  source: string;
}

export const MARKETPLACES: Record<MarketplaceId, Marketplace> = {
  EBAY_US: {
    id: "EBAY_US", country: "US", currency: "USD", symbol: "$", language: "en-US", listingLanguage: "en",
    fvfRate: 0.136, regulatoryRate: 0, perOrderFeeLow: 0.3, perOrderFeeHigh: 0.4, perOrderThreshold: 10, feeTaxRate: 0,
    verified: true, source: "https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees",
  },
  EBAY_CA: {
    id: "EBAY_CA", country: "CA", currency: "CAD", symbol: "C$", language: "en-CA", listingLanguage: "en",
    fvfRate: 0.136, regulatoryRate: 0, perOrderFeeLow: 0.3, perOrderFeeHigh: 0.4, perOrderThreshold: 10, feeTaxRate: 0,
    verified: true, source: "https://www.ebay.ca/sellercentre/selling/seller-fees",
  },
  EBAY_GB: {
    id: "EBAY_GB", country: "GB", currency: "GBP", symbol: "£", language: "en-GB", listingLanguage: "en",
    // Frais fixe vérifié (0,30 £ / 0,40 £ au-dessus de 10 £). Taux variable selon la catégorie : 12,9 % par défaut, À CONFIRMER.
    // TVA 20 % comptée sur les frais (cas d'un vendeur non assujetti) : estimation prudente.
    fvfRate: 0.129, regulatoryRate: 0, perOrderFeeLow: 0.3, perOrderFeeHigh: 0.4, perOrderThreshold: 10, feeTaxRate: 0.2,
    verified: false, source: "https://www.ebay.co.uk/sellercentre/news/2026-january/rate-card-change",
  },
  EBAY_AU: {
    id: "EBAY_AU", country: "AU", currency: "AUD", symbol: "A$", language: "en-AU", listingLanguage: "en",
    // 13,4 % jusqu'à 4 000 A$ + 0,30 A$ par commande : À CONFIRMER.
    fvfRate: 0.134, regulatoryRate: 0, perOrderFeeLow: 0.3, perOrderFeeHigh: 0.3, perOrderThreshold: 10, feeTaxRate: 0,
    verified: false, source: "https://www.ebay.com.au/help/selling/fees-credits-invoices/selling-fees",
  },
  EBAY_DE: {
    id: "EBAY_DE", country: "DE", currency: "EUR", symbol: "€", language: "de-DE", listingLanguage: "de",
    // Catégories standard : 14 % (12-13 % dans certaines catégories) + 0,35 € (0,45 € au-dessus de 10 €), hors TVA.
    fvfRate: 0.14, regulatoryRate: 0, perOrderFeeLow: 0.35, perOrderFeeHigh: 0.45, perOrderThreshold: 10, feeTaxRate: 0,
    verified: true, source: "https://www.ebay.de/help/selling/fees-credits-invoices/gebuhren-fur-gewerbliche-verkaufer?id=4809",
  },
  EBAY_FR: {
    id: "EBAY_FR", country: "FR", currency: "EUR", symbol: "€", language: "fr-FR", listingLanguage: "fr",
    // La plupart des catégories : 9 % + 0,35 € par commande + frais réglementaires 0,35 %, hors TVA.
    fvfRate: 0.09, regulatoryRate: 0.0035, perOrderFeeLow: 0.35, perOrderFeeHigh: 0.35, perOrderThreshold: 10, feeTaxRate: 0,
    verified: true, source: "https://www.ebay.fr/help/selling/fees-credits-invoices/services-de-paiement-frais-pour-les-vendeurs-particuliers?id=4809",
  },
  EBAY_IT: {
    id: "EBAY_IT", country: "IT", currency: "EUR", symbol: "€", language: "it-IT", listingLanguage: "it",
    // La maggior parte delle categorie : 11 % + 0,35 € par commande + 0,35 % réglementaire, hors TVA.
    fvfRate: 0.11, regulatoryRate: 0.0035, perOrderFeeLow: 0.35, perOrderFeeHigh: 0.35, perOrderThreshold: 10, feeTaxRate: 0,
    verified: true, source: "https://www.ebay.it/help/selling/fees-credits-invoices/servizi-di-pagamento-tariffe-per-venditori-professionali?id=4809",
  },
  EBAY_ES: {
    id: "EBAY_ES", country: "ES", currency: "EUR", symbol: "€", language: "es-ES", listingLanguage: "es",
    // La mayoría de categorías : 9 % (jusqu'à 990 €) + 0,35 € (0,45 € au-dessus de 10 €) + 0,35 % réglementaire, hors TVA.
    fvfRate: 0.09, regulatoryRate: 0.0035, perOrderFeeLow: 0.35, perOrderFeeHigh: 0.45, perOrderThreshold: 10, feeTaxRate: 0,
    verified: true, source: "https://www.ebay.es/help/selling/fees-credits-invoices/servicios-de-pago-comisiones-y-tarifas-para-vendedores-profesionales?id=4809",
  },
  EBAY_IE: {
    id: "EBAY_IE", country: "IE", currency: "EUR", symbol: "€", language: "en-IE", listingLanguage: "en",
    // Most categories : 11 % (jusqu'à 990 €) + 0,35 € (0,45 € au-dessus de 10 €) + 0,35 % réglementaire, hors TVA.
    fvfRate: 0.11, regulatoryRate: 0.0035, perOrderFeeLow: 0.35, perOrderFeeHigh: 0.45, perOrderThreshold: 10, feeTaxRate: 0,
    verified: true, source: "https://www.ebay.ie/help/selling/fees-credits-invoices/business-seller-fees?id=4809",
  },
};

export const MARKETPLACE_IDS = Object.keys(MARKETPLACES) as MarketplaceId[];

export function isMarketplaceId(v: unknown): v is MarketplaceId {
  return typeof v === "string" && v in MARKETPLACES;
}

export function marketplace(id: string | null | undefined): Marketplace {
  return isMarketplaceId(id) ? MARKETPLACES[id] : MARKETPLACES.EBAY_US;
}
