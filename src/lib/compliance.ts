/**
 * Règles de conformité eBay — non désactivables par le client.
 */

/** Détaillants interdits comme source (politique eBay sur le dropshipping). */
export const BLOCKED_RETAILER_DOMAINS = [
  "amazon.com", "walmart.com", "target.com", "bestbuy.com", "costco.com",
  "homedepot.com", "lowes.com", "kohls.com", "macys.com",
];

export function isBlockedSourceUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return BLOCKED_RETAILER_DOMAINS.some((d) => host === d || host.endsWith("." + d));
  } catch {
    return false;
  }
}

/**
 * Marques protégées (programme VeRO). Liste de départ à compléter :
 * la liste complète doit être tenue à jour dans la base de données.
 */
export const VERO_BRANDS = [
  "apple", "nike", "adidas", "disney", "marvel", "lego", "sony", "samsung", "bose",
  "dyson", "ugg", "north face", "louis vuitton", "gucci", "chanel", "rolex", "otterbox",
  "yeti", "stanley", "pokemon", "nintendo", "hello kitty", "michael kors", "coach",
];

export function findVeroBrand(text: string): string | null {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ")} `;
  return VERO_BRANDS.find((b) => t.includes(` ${b} `)) ?? null;
}

/** Nombre maximum d'annonces par jour selon l'âge du compte eBay. */
export function dailyListingLimit(accountOpenedAt: Date | null, now = new Date()): number {
  if (!accountOpenedAt) return 5;
  const days = (now.getTime() - accountOpenedAt.getTime()) / 86_400_000;
  if (days < 30) return 5;
  if (days < 90) return 15;
  if (days < 180) return 30;
  return 50;
}

export interface ComplianceCheck {
  ok: boolean;
  reasons: string[];
}

export function checkListing(input: {
  title: string;
  brand?: string;
  sourceUrl?: string;
  deliveryDaysMax: number;
  listedToday: number;
  accountOpenedAt: Date | null;
}): ComplianceCheck {
  const reasons: string[] = [];
  if (input.sourceUrl && isBlockedSourceUrl(input.sourceUrl)) reasons.push("Fournisseur interdit par eBay (détaillant).");
  const vero = findVeroBrand(`${input.title} ${input.brand ?? ""}`);
  if (vero) reasons.push(`Marque protégée (VeRO) : ${vero}.`);
  if (input.deliveryDaysMax > 8) reasons.push("Livraison trop lente (plus de 8 jours).");
  const limit = dailyListingLimit(input.accountOpenedAt);
  if (input.listedToday >= limit) reasons.push(`Limite du jour atteinte (${limit} annonces).`);
  return { ok: reasons.length === 0, reasons };
}
