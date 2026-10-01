/**
 * Sniper : règles pures (sans base de données ni appel réseau), testées séparément.
 * Le Sniper parcourt les produits d'un fournisseur stockés dans le pays (ou une liste de mots-clés),
 * vérifie la vraie demande eBay et la marge après tous les frais, et ne garde que les produits rentables.
 */
import { findVeroBrand } from "@/lib/compliance";
import type { Evaluation } from "@/lib/margin";
import type { MarketInsights } from "@/lib/market-insights";

/** Tout ce que le Sniper a mesuré pour un produit (affiché dans sa fiche). Montants dans la devise du pays. */
export interface CandidateDetails {
  market?: MarketInsights;
  supplierPrice?: number | null;  // prix du fournisseur (variante la moins chère en stock)
  shipping?: number | null;       // livraison du fournisseur
  fees?: number | null;           // frais eBay au prix du marché
  stock?: number | null;          // stock du fournisseur dans le pays
  minPrice?: number | null;       // prix de vente minimum pour la marge visée
}

/** Nombre maximum de produits à trouver par recherche. */
export const MAX_TARGET = 50;
/** Nombre maximum de mots-clés dans une liste. */
export const MAX_KEYWORDS = 50;
/** On arrête de parcourir le catalogue après autant de produits analysés par produit demandé. */
export const SCAN_FACTOR = 25;
export const MAX_SCAN = 400;
/** Ventes minimum (estimation eBay sur les annonces comparables) pour considérer qu'il y a une demande. */
export const MIN_UNITS_SOLD = 3;
/** Variantes en stock analysées par produit (les moins chères) : limite les appels au fournisseur. */
export const MAX_VARIANTS = 3;
/** Une recherche abandonnée par le navigateur est reprise par la tâche planifiée après ce délai. */
export const RESUME_AFTER_MS = 2 * 60_000;

/** « High ticket » : produits chers à revendre, au moins ce profit par vente (devise du pays). */
export const HIGH_TICKET_PROFIT = 100;
/** Thèmes du catalogue où se trouvent les produits chers (entrepôts locaux). */
export const HIGH_TICKET_SEEDS = [
  "electric bike", "electric scooter", "portable power station", "massage chair", "treadmill", "exercise bike",
  "rowing machine", "home gym", "office chair", "gaming chair", "standing desk", "sofa", "bed frame", "mattress",
  "dining table", "patio furniture", "outdoor furniture", "gazebo", "grill", "pizza oven", "kayak", "golf cart",
  "hot tub", "sauna", "air conditioner", "generator", "solar panel", "projector", "espresso machine", "robot vacuum",
];

/**
 * Catégories proposées au vendeur dans le Sniper : chacune correspond à des thèmes de recherche dans le catalogue CJ.
 * Sans catégorie choisie, le Sniper parcourt les thèmes populaires (DEFAULT_SEEDS).
 */
export const PRODUCT_CATEGORIES = [
  { id: "kitchen", seeds: ["kitchen gadget", "kitchen tools", "kitchen storage"] },
  { id: "home", seeds: ["home organization", "storage box", "home decor"] },
  { id: "pets", seeds: ["pet supplies", "dog toys", "cat toys"] },
  { id: "car", seeds: ["car accessories", "car organizer", "car cleaning"] },
  { id: "phone", seeds: ["phone accessories", "phone holder", "charging cable"] },
  { id: "electronics", seeds: ["smart gadget", "bluetooth speaker", "wireless charger"] },
  { id: "fitness", seeds: ["fitness equipment", "yoga mat", "resistance bands"] },
  { id: "beauty", seeds: ["beauty tools", "makeup brush", "hair styling tool"] },
  { id: "lighting", seeds: ["led lights", "night light", "solar lights"] },
  { id: "garden", seeds: ["garden tools", "plant pot", "garden decor"] },
  { id: "baby", seeds: ["baby products", "baby toys", "baby feeding"] },
  { id: "office", seeds: ["office supplies", "desk organizer", "stationery"] },
  { id: "bathroom", seeds: ["bathroom accessories", "shower organizer", "bath mat"] },
  { id: "outdoor", seeds: ["camping gear", "hiking accessories", "outdoor tools"] },
  { id: "cleaning", seeds: ["cleaning tools", "cleaning brush", "mop"] },
  { id: "travel", seeds: ["travel accessories", "travel organizer", "luggage accessories"] },
  { id: "toys", seeds: ["toys", "educational toys", "puzzle"] },
  { id: "tools", seeds: ["hand tools", "tool organizer", "measuring tools"] },
  { id: "sports", seeds: ["sports accessories", "cycling accessories", "fishing accessories"] },
] as const;
export type CategoryId = (typeof PRODUCT_CATEGORIES)[number]["id"];
export const CATEGORY_IDS = PRODUCT_CATEGORIES.map((c) => c.id) as CategoryId[];
export const isCategoryId = (v: unknown): v is CategoryId => typeof v === "string" && (CATEGORY_IDS as string[]).includes(v);

/** Thèmes de recherche des catégories choisies (sans doublon, dans l'ordre des catégories). */
export function seedsForCategories(ids: readonly string[]): string[] {
  const out: string[] = [];
  for (const c of PRODUCT_CATEGORIES) if (ids.includes(c.id)) for (const s of c.seeds) if (!out.includes(s)) out.push(s);
  return out;
}

/** Prix d'achat fournisseur dans la fourchette du vendeur ? (bornes facultatives) */
export function inCostRange(cost: number | null | undefined, min?: number | null, max?: number | null): boolean {
  if (min == null && max == null) return true;
  if (cost == null || !Number.isFinite(cost)) return false;
  return (min == null || cost >= min) && (max == null || cost <= max);
}

/** Thèmes utilisés quand le vendeur n'en donne pas : catégories « evergreen » qui se vendent toute l'année. */
export const DEFAULT_SEEDS = [
  "kitchen gadget", "pet supplies", "car accessories", "home organization", "phone accessories",
  "fitness equipment", "beauty tools", "led lights", "garden tools", "baby products",
  "office supplies", "bathroom accessories", "camping gear", "cleaning tools", "travel accessories",
];

/** Thèmes parcourus par le scanner de fond : thèmes populaires + toutes les catégories (chaque catégorie a des produits prêts). */
export const SCANNER_SEEDS: string[] = [...new Set<string>([...DEFAULT_SEEDS, ...PRODUCT_CATEGORIES.flatMap((c) => c.seeds)])];

export function maxScan(target: number): number {
  return Math.min(MAX_SCAN, Math.max(20, target * SCAN_FACTOR));
}

/** Nettoie une liste de mots-clés collée par le vendeur (une ligne ou une virgule par mot-clé). */
export function parseKeywords(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\n,;]+/)) {
    const k = raw.replace(/\s+/g, " ").trim().slice(0, 120);
    if (k.length < 2 || seen.has(k.toLowerCase())) continue;
    seen.add(k.toLowerCase());
    out.push(k);
    if (out.length >= MAX_KEYWORDS) break;
  }
  return out;
}

const FILLER = new Set([
  "new", "hot", "sale", "best", "top", "quality", "high", "fashion", "style", "stylish", "creative", "portable", "multifunctional",
  "multifunction", "multi", "function", "professional", "premium", "upgraded", "upgrade", "original", "genuine", "free", "shipping",
  "wholesale", "dropshipping", "cheap", "2023", "2024", "2025", "2026", "for", "with", "and", "the", "a", "an", "of", "in", "to", "on",
  "pcs", "pc", "set", "piece", "pieces", "1pc", "2pcs", "3pcs", "4pcs", "5pcs", "10pcs", "x", "cj", "amazon", "ebay",
]);

/**
 * Titre fournisseur → recherche eBay courte (ce qu'un acheteur taperait) :
 * on retire le bruit (« 2024 New Hot Sale… »), les tailles et quantités, et on garde les 5 premiers mots utiles.
 */
export function keywordFromTitle(title: string, maxWords = 5): string {
  const words = title
    .toLowerCase()
    .replace(/[【】\[\]()（）{}"“”'’|/\\+*#!?:;.,]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w) && !/^\d+([.,]\d+)?(cm|mm|m|ml|l|g|kg|oz|in|inch|w|v|mah|pcs)?$/.test(w) && !/^[\d-]+$/.test(w) && w.length > 1);
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const w of words) {
    if (seen.has(w)) continue;
    seen.add(w);
    kept.push(w);
    if (kept.length >= maxWords) break;
  }
  return kept.join(" ");
}

export type Reason = "LOW_MARGIN" | "LOW_PROFIT" | "COST_RANGE" | "NO_DEMAND" | "NO_PRICE" | "NO_SUPPLIER" | "VERO" | "PRICE_RANGE" | "ALREADY_LISTED" | "NO_KEYWORD";

export interface Classification {
  status: "PROFITABLE" | "REJECTED";
  reason?: Reason;
}

/**
 * Décide si un produit est gardé : rentable après frais, vraie demande eBay (ventes estimées),
 * prix du marché dans la fourchette voulue, pas de marque protégée.
 */
export function classify(
  e: Evaluation,
  o: {
    unitsSold: number; priceMin?: number | null; priceMax?: number | null; title?: string | null; minUnits?: number; minProfit?: number | null;
    costMin?: number | null; costMax?: number | null;
  },
): Classification {
  if (o.title && findVeroBrand(o.title)) return { status: "REJECTED", reason: "VERO" };
  if (e.verdict === "PAS_DE_FOURNISSEUR") return { status: "REJECTED", reason: "NO_SUPPLIER" };
  // Prix d'achat chez le fournisseur (sans la livraison) hors de la fourchette choisie.
  if (e.best && !inCostRange(e.best.price, o.costMin, o.costMax)) return { status: "REJECTED", reason: "COST_RANGE" };
  if (e.verdict === "PAS_DE_PRIX") return { status: "REJECTED", reason: "NO_PRICE" };
  if (e.marketPrice !== null) {
    if (o.priceMin != null && e.marketPrice < o.priceMin) return { status: "REJECTED", reason: "PRICE_RANGE" };
    if (o.priceMax != null && e.marketPrice > o.priceMax) return { status: "REJECTED", reason: "PRICE_RANGE" };
  }
  if (e.verdict === "TROP_FAIBLE") return { status: "REJECTED", reason: "LOW_MARGIN" };
  if (o.minProfit != null && (e.margin?.profit ?? 0) < o.minProfit) return { status: "REJECTED", reason: "LOW_PROFIT" };
  if (o.unitsSold < (o.minUnits ?? MIN_UNITS_SOLD)) return { status: "REJECTED", reason: "NO_DEMAND" };
  return { status: "PROFITABLE" };
}

/** Recherche terminée ? */
export function isFinished(r: { mode: "CATALOG" | "KEYWORDS"; target: number; found: number; scanned: number; pending: number; exhausted: boolean; scanLimit?: number | null }): boolean {
  if (r.found >= r.target) return true;
  if (r.mode === "KEYWORDS") return r.pending === 0;
  return r.pending === 0 && (r.exhausted || r.scanned >= (r.scanLimit ?? maxScan(r.target)));
}
