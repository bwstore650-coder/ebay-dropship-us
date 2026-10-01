/**
 * Recherche marché (fonctions pures, testées) :
 *  - mots-clés qui vendent (Title Builder),
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
