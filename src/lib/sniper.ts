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
export const SCAN_FACTOR = 8;
export const MAX_SCAN = 150;
/** Ventes minimum (estimation eBay sur les annonces comparables) pour considérer qu'il y a une demande. */
export const MIN_UNITS_SOLD = 3;
/** Variantes en stock analysées par produit (les moins chères) : limite les appels au fournisseur. */
export const MAX_VARIANTS = 3;
/** Une recherche abandonnée par le navigateur est reprise par la tâche planifiée après ce délai. */
export const RESUME_AFTER_MS = 2 * 60_000;

/** Thèmes utilisés quand le vendeur n'en donne pas : catégories « evergreen » qui se vendent toute l'année. */
export const DEFAULT_SEEDS = [
  "kitchen gadget", "pet supplies", "car accessories", "home organization", "phone accessories",
  "fitness equipment", "beauty tools", "led lights", "garden tools", "baby products",
  "office supplies", "bathroom accessories", "camping gear", "cleaning tools", "travel accessories",
];

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

export type Reason = "LOW_MARGIN" | "NO_DEMAND" | "NO_PRICE" | "NO_SUPPLIER" | "VERO" | "PRICE_RANGE" | "ALREADY_LISTED" | "NO_KEYWORD";

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
  o: { unitsSold: number; priceMin?: number | null; priceMax?: number | null; title?: string | null; minUnits?: number },
): Classification {
  if (o.title && findVeroBrand(o.title)) return { status: "REJECTED", reason: "VERO" };
  if (e.verdict === "PAS_DE_PRIX") return { status: "REJECTED", reason: "NO_PRICE" };
  if (e.verdict === "PAS_DE_FOURNISSEUR") return { status: "REJECTED", reason: "NO_SUPPLIER" };
  if (e.marketPrice !== null) {
    if (o.priceMin != null && e.marketPrice < o.priceMin) return { status: "REJECTED", reason: "PRICE_RANGE" };
    if (o.priceMax != null && e.marketPrice > o.priceMax) return { status: "REJECTED", reason: "PRICE_RANGE" };
  }
  if (e.verdict === "TROP_FAIBLE") return { status: "REJECTED", reason: "LOW_MARGIN" };
  if (o.unitsSold < (o.minUnits ?? MIN_UNITS_SOLD)) return { status: "REJECTED", reason: "NO_DEMAND" };
  return { status: "PROFITABLE" };
}

/** Recherche terminée ? */
export function isFinished(r: { mode: "CATALOG" | "KEYWORDS"; target: number; found: number; scanned: number; pending: number; exhausted: boolean }): boolean {
  if (r.found >= r.target) return true;
  if (r.mode === "KEYWORDS") return r.pending === 0;
  return r.pending === 0 && (r.exhausted || r.scanned >= maxScan(r.target));
}
