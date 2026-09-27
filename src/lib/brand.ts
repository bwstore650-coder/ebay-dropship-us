/**
 * Nom et identité de la marque — À CHANGER ICI UNIQUEMENT.
 * « ProfitLister » est un nom de travail : vérifie la disponibilité (marque, domaine) avant le lancement.
 * N'utilise pas « eBay » dans le nom : c'est une marque déposée d'eBay Inc.
 */
export const BRAND = {
  name: process.env.NEXT_PUBLIC_BRAND_NAME || "ProfitLister",
  company: "RADIANT VITA DS LLC",
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@example.com",
};
