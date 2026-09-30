/**
 * Recherche marché (fonctions pures, testées) :
 *  - rapport sur un vendeur eBay (espion de concurrents),
 *  - mots-clés qui vendent (Title Builder),
 *  - classement des meilleures ventes.
 * Les ventes viennent de l'estimation officielle d'eBay (cumulée depuis la mise en ligne de l'annonce).
 */
import { findVeroBrand } from "@/lib/compliance";

export interface SoldItem {
  id: string;
  title: string;
  price: number;
  sold: number;
  url?: string;
  image?: string;
  categoryId?: string;
}

/* ---------- Espion de concurrents ---------- */

export interface SellerReport {
  listings: number;       // annonces analysées
  totalListings: number;  // annonces actives trouvées chez eBay
  unitsSold: number;
  revenue: number;        // ventes × prix actuel (estimation)
  avgPrice: number;
  sellThrough: number;    // % d'annonces qui ont vendu au moins une fois
  top: SoldItem[];        // meilleures ventes
  categories: { categoryId: string; listings: number; unitsSold: number }[];
}

export function sellerReport(items: SoldItem[], totalListings: number, topN = 50): SellerReport {
  const unitsSold = items.reduce((s, i) => s + i.sold, 0);
  const revenue = round2(items.reduce((s, i) => s + i.sold * i.price, 0));
  const avgPrice = items.length ? round2(items.reduce((s, i) => s + i.price, 0) / items.length) : 0;
  const withSales = items.filter((i) => i.sold > 0).length;
  const byCat = new Map<string, { categoryId: string; listings: number; unitsSold: number }>();
  for (const i of items) {
    if (!i.categoryId) continue;
    const c = byCat.get(i.categoryId) ?? { categoryId: i.categoryId, listings: 0, unitsSold: 0 };
    c.listings++;
    c.unitsSold += i.sold;
    byCat.set(i.categoryId, c);
  }
  return {
    listings: items.length,
    totalListings: Math.max(totalListings, items.length),
    unitsSold,
    revenue,
    avgPrice,
    sellThrough: items.length ? Math.round((withSales / items.length) * 100) : 0,
    top: [...items].sort((a, b) => b.sold - a.sold || b.price - a.price).slice(0, topN),
    categories: [...byCat.values()].sort((a, b) => b.unitsSold - a.unitsSold).slice(0, 8),
  };
}

/** Nom de vendeur eBay valide (lettres, chiffres, . _ - *, 2 à 64 caractères). */
export function normalizeSeller(input: string): string | null {
  let s = input.trim();
  // Lien de boutique ou de profil : ebay.com/str/NOM, ebay.com/usr/NOM, ?_ssn=NOM
  const m = s.match(/(?:\/(?:usr|str)\/|[?&]_ssn=)([^/?&#]+)/i);
  if (m) s = decodeURIComponent(m[1]);
  s = s.replace(/^@/, "").trim().toLowerCase();
  return /^[a-z0-9._*-]{2,64}$/.test(s) ? s : null;
}

/* ---------- Title Builder ---------- */

const STOP = new Set([
  // anglais
  "a", "an", "and", "the", "for", "with", "of", "in", "on", "to", "by", "from", "at", "or", "as", "is", "it", "this", "that", "your", "you",
  "new", "free", "shipping", "fast", "sale", "hot", "best", "top", "quality", "brand",
  // français, allemand, italien, espagnol
  "le", "la", "les", "de", "des", "du", "et", "pour", "avec", "en", "un", "une", "au", "aux", "neuf",
  "der", "die", "das", "und", "für", "mit", "von", "zu", "ein", "eine", "neu",
  "il", "lo", "gli", "di", "e", "per", "con", "da", "un", "una", "nuovo",
  "el", "los", "las", "y", "para", "con", "del", "una", "nuevo",
]);

export interface KeywordStat {
  word: string;
  listings: number;   // annonces dont le titre contient le mot
  sold: number;       // ventes de ces annonces
  score: number;      // part des ventes (0-100)
  vero: boolean;      // marque protégée : à ne pas utiliser
}

export function tokenize(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^-+|-+$/g, ""))
    .filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w));
}

/** Mots des titres classés par ventes : un mot compte pour toutes les ventes des annonces qui l'utilisent. */
export function titleKeywords(items: SoldItem[], limit = 40): KeywordStat[] {
  const totalSold = items.reduce((s, i) => s + i.sold, 0);
  const stats = new Map<string, { listings: number; sold: number }>();
  for (const it of items) {
    for (const w of new Set(tokenize(it.title))) {
      const s = stats.get(w) ?? { listings: 0, sold: 0 };
      s.listings++;
      s.sold += it.sold;
      stats.set(w, s);
    }
  }
  const minListings = items.length >= 10 ? 2 : 1; // un mot vu une seule fois sur 50 annonces n'est pas un signal
  return [...stats.entries()]
    .filter(([, s]) => s.listings >= minListings)
    .map(([word, s]) => ({
      word,
      listings: s.listings,
      sold: s.sold,
      score: totalSold ? Math.round((s.sold / totalSold) * 100) : Math.round((s.listings / Math.max(1, items.length)) * 100),
      vero: Boolean(findVeroBrand(word)),
    }))
    .sort((a, b) => b.sold - a.sold || b.listings - a.listings || a.word.localeCompare(b.word))
    .slice(0, limit);
}

export const TITLE_MAX = 80;

/** Titre proposé : les meilleurs mots dans l'ordre, sans marque protégée, jusqu'à 80 caractères. */
export function suggestTitle(keywords: KeywordStat[], max = TITLE_MAX): string {
  const words: string[] = [];
  let len = 0;
  for (const k of keywords) {
    if (k.vero) continue;
    const add = (words.length ? 1 : 0) + k.word.length;
    if (len + add > max) continue;
    words.push(k.word);
    len += add;
  }
  return words.map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w.toUpperCase())).join(" ");
}

/* ---------- Meilleures ventes ---------- */

/** Niches de dropshipping suivies chaque jour (la catégorie eBay de chaque pays est retrouvée à partir de ces mots). */
export const TREND_NICHES = [
  "kitchen gadgets", "pet supplies", "car accessories", "home storage organization", "phone accessories",
  "fitness equipment", "beauty tools", "led lighting", "garden tools", "baby care",
  "office supplies", "bathroom accessories", "camping gear", "cleaning tools", "travel accessories", "toys games",
];

/** Ventes du jour = ventes cumulées aujourd'hui − ventes cumulées au relevé précédent (jamais négatif). */
export function dailySales(sold: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined) return null;
  return Math.max(0, sold - previous);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
