/**
 * Annonces eBay comparables à un produit fournisseur (fonctions pures, testées).
 * La recherche par image d'eBay classe toutes les annonces par ressemblance : on garde celles qui
 * ressemblent vraiment (titre et prix cohérents), puis on en déduit une recherche précise
 * (mots-clés communs, catégorie, gamme de prix) pour compter les concurrents.
 */

const STOP = new Set([
  "the", "and", "for", "with", "from", "new", "set", "pcs", "pack", "piece", "pieces", "inch", "inches", "home", "use", "your", "you",
  "free", "shipping", "fast", "hot", "sale", "best", "top", "quality", "high", "premium", "brand", "black", "white", "gray", "grey",
  "red", "blue", "green", "pink", "color", "colors", "size", "sizes", "large", "small", "medium", "mini", "item", "items", "us", "usa",
  "adjustable", "heavy", "duty", "multi", "function", "functional", "portable", "upgraded", "upgrade", "durable", "professional",
]);

/** Mots significatifs d'un titre (minuscules, sans chiffres seuls, sans mots vides). */
export function titleWords(title: string): string[] {
  const words = title.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9][a-z0-9-]{2,}/g) ?? [];
  return [...new Set(words.map((w) => w.replace(/-+$/, "")).filter((w) => w.length >= 3 && /[a-z]/.test(w) && !STOP.has(w)))];
}

/** Mots présents dans au moins `minShare` des titres, du plus fréquent au moins fréquent. */
export function consensusWords(titles: string[], minShare = 0.4, max = 5): string[] {
  if (!titles.length) return [];
  const freq = new Map<string, number>();
  for (const t of titles) for (const w of titleWords(t)) freq.set(w, (freq.get(w) ?? 0) + 1);
  const need = Math.max(2, Math.ceil(titles.length * minShare));
  return [...freq.entries()]
    .filter(([, n]) => n >= need)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([w]) => w);
}

export function medianOf(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export interface Listing { id: string; title: string; price: number; categoryId?: string; createdAt?: string; image?: string; url?: string }

export interface ComparableSet<T extends Listing> {
  matches: T[];          // annonces retenues, dans l'ordre de ressemblance d'eBay
  keywords: string[];    // mots communs aux annonces retenues
  categoryId: string | null;
  medianPrice: number | null;
  priceMin: number | null; // gamme de prix pour compter les concurrents
  priceMax: number | null;
}

/**
 * Prix de revente plausibles pour un produit qui coûte `cost` chez le fournisseur : une annonce à plus de
 * 6 fois ce prix (ou 40 de plus pour les petits prix), ou à moins de la moitié, est un autre produit
 * (ex. une serre en polycarbonate à 440 $ pour une mini-serre en PVC à 39 $).
 */
export function costBand(cost: number): { min: number; max: number } {
  return { min: Math.round(cost * 0.5 * 100) / 100, max: Math.round(Math.max(cost * 6, cost + 40) * 100) / 100 };
}

/** Prix gardés autour du prix médian des annonces les plus ressemblantes. */
export const PRICE_BAND = { keepLow: 0.5, keepHigh: 2, countLow: 0.6, countHigh: 1.6 };

/**
 * Garde les annonces vraiment comparables parmi les résultats de la recherche par image :
 * prix proche du médian des premières annonces, et titre qui partage les mots communs.
 */
export function pickComparables<T extends Listing>(items: T[], opts: { top?: number; supplierCost?: number | null } = {}): ComparableSet<T> {
  const band = opts.supplierCost ? costBand(opts.supplierCost) : null;
  const head = items
    .filter((i) => i.price > 0 && (!band || (i.price >= band.min && i.price <= band.max)))
    .slice(0, opts.top ?? 30);
  const median0 = medianOf(head.map((i) => i.price));
  if (median0 === null) return { matches: [], keywords: [], categoryId: null, medianPrice: null, priceMin: null, priceMax: null };
  const priced = head.filter((i) => i.price >= median0 * PRICE_BAND.keepLow && i.price <= median0 * PRICE_BAND.keepHigh);
  const keywords = consensusWords(priced.map((i) => i.title));
  const need = keywords.length ? Math.max(1, Math.ceil(keywords.length / 2)) : 0;
  const matches = priced.filter((i) => {
    if (!need) return true;
    const w = new Set(titleWords(i.title));
    return keywords.filter((k) => w.has(k)).length >= need;
  });
  const median = medianOf(matches.map((i) => i.price));
  const cats = new Map<string, number>();
  for (const m of matches) if (m.categoryId) cats.set(m.categoryId, (cats.get(m.categoryId) ?? 0) + 1);
  const categoryId = [...cats.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    matches,
    keywords,
    categoryId,
    medianPrice: median === null ? null : round(median),
    priceMin: median === null ? null : round(median * PRICE_BAND.countLow),
    priceMax: median === null ? null : round(median * PRICE_BAND.countHigh),
  };
}

const MONTH_MS = 30.44 * 86_400_000;

/**
 * Ventes estimées par mois : pour chaque annonce, ventes cumulées ÷ mois en ligne (1 mois minimum),
 * additionnées. Les annonces sans date de mise en ligne comptent au rythme moyen des autres.
 */
export function monthlySales(listings: { sold: number; createdAt?: string }[], now = Date.now()): number | null {
  if (!listings.length) return null;
  const dated = listings.filter((l) => l.createdAt && Number.isFinite(Date.parse(l.createdAt)));
  if (!dated.length) return null;
  const rate = dated.reduce((s, l) => s + l.sold / Math.max(1, (now - Date.parse(l.createdAt!)) / MONTH_MS), 0);
  return Math.round(rate * (listings.length / dated.length));
}
