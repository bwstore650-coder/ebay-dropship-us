/**
 * Règles de conformité eBay — non désactivables par le client.
 */

/** Détaillants interdits comme source (politique eBay sur le dropshipping). */
export const BLOCKED_RETAILER_DOMAINS = [
  // États-Unis
  "amazon.com", "walmart.com", "target.com", "bestbuy.com", "costco.com",
  "homedepot.com", "lowes.com", "kohls.com", "macys.com",
  // Canada, Royaume-Uni, Australie
  "amazon.ca", "walmart.ca", "canadiantire.ca", "bestbuy.ca", "costco.ca",
  "amazon.co.uk", "argos.co.uk", "tesco.com", "currys.co.uk", "johnlewis.com",
  "amazon.com.au", "kmart.com.au", "bigw.com.au", "target.com.au", "jbhifi.com.au",
  // Allemagne, France, Italie, Espagne, Irlande
  "amazon.de", "otto.de", "mediamarkt.de", "saturn.de", "kaufland.de", "lidl.de", "zalando.de",
  "amazon.fr", "cdiscount.com", "fnac.com", "darty.com", "boulanger.com", "carrefour.fr", "leroymerlin.fr", "zalando.fr",
  "amazon.it", "mediaworld.it", "unieuro.it", "zalando.it",
  "amazon.es", "elcorteingles.es", "mediamarkt.es", "pccomponentes.com", "zalando.es",
  "harveynorman.ie", "currys.ie", "argos.ie",
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
  // Autres marques très surveillées sur eBay (programme VeRO).
  "iphone", "ipad", "airpods", "macbook", "airtag", "playstation", "xbox", "gopro", "fitbit", "garmin",
  "jbl", "beats by dre", "ray ban", "oakley", "prada", "hermes", "burberry", "dior", "versace", "fendi",
  "balenciaga", "cartier", "tiffany", "pandora", "supreme", "lululemon", "crocs", "birkenstock", "timberland",
  "under armour", "new balance", "yeezy", "harry potter", "star wars", "barbie", "hot wheels", "funko", "owala", "dji",
];

/**
 * Imitations de produits de marque qui ne citent pas la marque (ex. « S24 Ultra 5G unlocked smartphone »,
 * copie d'un Samsung Galaxy) : eBay les traite comme de la contrefaçon.
 */
const KNOCKOFFS: { brand: string; test: (t: string) => boolean }[] = [
  // Téléphones qui reprennent un nom de modèle Samsung (S24 Ultra, 24 Ultra…) ou Apple (i15 Pro Max, 16 Pro Max…).
  {
    brand: "samsung",
    test: (t) =>
      (/\b(s|note ?)?\d{2} ?ultra\b/.test(t) && /\b(phone|smartphone|cellphone|cell phone|unlocked|android|5g|4g|dual sim)\b/.test(t)) ||
      // Noms de la gamme Galaxy (A17, S25, M34, Z Fold…) sur un vrai téléphone vendu seul.
      (/\b(galaxy ?)?[asmfz] ?\d{2,3}\b/.test(t) && /\b(smartphone|cellphone|cell phone|unlocked|android|dual sim)\b/.test(t)),
  },
  {
    brand: "apple",
    test: (t) => /\b(i ?)?\d{2} ?pro ?max\b/.test(t) && /\b(phone|smartphone|cellphone|cell phone|unlocked|android|5g|4g|dual sim)\b/.test(t),
  },
  // Chaussures « Jordan » (Nike).
  { brand: "nike", test: (t) => /\bjordan\b/.test(t) && /\b(shoe|shoes|sneaker|sneakers|basketball)\b/.test(t) },
];

export function findVeroBrand(text: string): string | null {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ")} `;
  return VERO_BRANDS.find((b) => t.includes(` ${b} `)) ?? KNOCKOFFS.find((k) => k.test(t))?.brand ?? null;
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
