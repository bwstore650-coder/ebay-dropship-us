/**
 * Règles d'une annonce eBay (fonctions pures, testées) : SKU, titre, description, caractéristiques, catégorie.
 */
import { findVeroBrand } from "@/lib/compliance";
import type { AspectDef } from "@/lib/ebay";
import { marketplace, type MarketplaceId } from "@/lib/marketplaces";

export const TITLE_MAX = 80;
export const DESCRIPTION_MAX = 4000; // limite d'eBay pour la description de l'article (API Inventory)
export const ASPECT_NAME_MAX = 40;
export const ASPECT_VALUE_MAX = 50;
export const MAX_IMAGES = 24;
export const DEFAULT_QUANTITY = 3; // quantité affichée : faible, pour éviter la survente

/** Valeur « sans marque » acceptée par eBay dans chaque langue (produits génériques de fournisseurs). */
export const UNBRANDED: Record<string, string> = { en: "Unbranded", de: "Markenlos", fr: "Sans marque", it: "Senza marca", es: "Sin marca" };
/** Nom de la caractéristique « Marque » selon la langue du site. */
export const BRAND_ASPECT: Record<string, string> = { en: "Brand", de: "Marke", fr: "Marque", it: "Marca", es: "Marca" };

/** SKU unique (≤ 50 caractères) : préfixe, horodatage et hasard. */
export function makeSku(now = Date.now(), rand = Math.random): string {
  const r = Math.floor(rand() * 36 ** 6).toString(36).padStart(6, "0");
  return `PL-${now.toString(36)}-${r}`.toUpperCase();
}

/** Titre propre : espaces normalisés, ≤ 80 caractères, coupé sur un mot entier. */
export function cleanTitle(raw: string): string {
  const t = raw.replace(/\s+/g, " ").replace(/[<>]/g, "").trim();
  if (t.length <= TITLE_MAX) return t;
  const cut = t.slice(0, TITLE_MAX + 1);
  const space = cut.lastIndexOf(" ");
  return (space > 40 ? cut.slice(0, space) : t.slice(0, TITLE_MAX)).replace(/[\s,;:\-–—/|]+$/, "");
}

/**
 * Description HTML sûre pour eBay : pas de scripts, formulaires, iframes, styles, liens externes ni attributs actifs.
 * Au-delà de 4 000 caractères, on garde du texte simple tronqué.
 */
export function sanitizeDescription(html: string): string {
  let s = html
    .replace(/<\s*(script|style|iframe|object|embed|form|noscript|svg|video|audio)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|style|iframe|object|embed|form|input|button|link|meta|base|img|video|audio|source)\b[^>]*>/gi, "")
    .replace(/<\s*\/?\s*a\b[^>]*>/gi, "") // liens retirés, texte conservé
    .replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+(style|class|id|href|src)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "")
    .trim();
  if (s.length > DESCRIPTION_MAX) {
    const text = s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    s = `<p>${text.slice(0, DESCRIPTION_MAX - 20).replace(/\s+\S*$/, "")}…</p>`;
  }
  return s;
}

/** Catégorie la plus fréquente parmi les annonces comparables (null si aucune). */
export function mostCommon(ids: (string | undefined | null)[]): string | null {
  const counts = new Map<string, number>();
  let best: string | null = null;
  for (const id of ids) {
    if (!id) continue;
    const n = (counts.get(id) ?? 0) + 1;
    counts.set(id, n);
    if (best === null || n > (counts.get(best) ?? 0)) best = id;
  }
  return best;
}

export interface AspectResult {
  aspects: Record<string, string[]>;
  missingRequired: string[];
}

/**
 * Caractéristiques finales : on garde les valeurs proposées (IA ou vendeur) qui respectent les règles d'eBay,
 * on force « Marque = Sans marque » et on liste les caractéristiques obligatoires encore vides.
 */
export function buildAspects(input: Record<string, string[] | string>, defs: AspectDef[], marketId: MarketplaceId): AspectResult {
  const lang = marketplace(marketId).listingLanguage;
  const byName = new Map(defs.map((d) => [d.name.toLowerCase(), d]));
  const out: Record<string, string[]> = {};
  for (const [rawName, rawValues] of Object.entries(input)) {
    const name = rawName.trim().slice(0, ASPECT_NAME_MAX);
    if (!name) continue;
    const def = byName.get(name.toLowerCase());
    const finalName = def?.name ?? name;
    let values = (Array.isArray(rawValues) ? rawValues : [rawValues])
      .map((v) => String(v).trim())
      .filter(Boolean)
      .map((v) => v.slice(0, Math.min(ASPECT_VALUE_MAX, def?.maxLength ?? ASPECT_VALUE_MAX)));
    if (def?.mode === "SELECTION_ONLY") {
      const allowed = new Map(def.values.map((v) => [v.toLowerCase(), v]));
      values = values.map((v) => allowed.get(v.toLowerCase())).filter((v): v is string => Boolean(v));
    }
    if (def && !def.multi) values = values.slice(0, 1);
    values = [...new Set(values)];
    if (values.length) out[finalName] = values;
  }
  // Marque : toujours « Sans marque » (on ne revend jamais une marque dont on n'est pas distributeur).
  const brandDef = defs.find((d) => d.name.toLowerCase() === BRAND_ASPECT[lang].toLowerCase());
  const brandName = brandDef?.name ?? BRAND_ASPECT[lang];
  for (const k of Object.keys(out)) if (k.toLowerCase() === brandName.toLowerCase()) delete out[k];
  out[brandName] = [UNBRANDED[lang]];
  const missingRequired = defs.filter((d) => d.required && !out[d.name]?.length).map((d) => d.name);
  return { aspects: out, missingRequired };
}

/** Marque protégée trouvée dans le titre ou les caractéristiques (null si aucune). */
export function veroIn(title: string, aspects: Record<string, string[]>): string | null {
  return findVeroBrand([title, ...Object.values(aspects).flat()].join(" "));
}

/** Images valides pour eBay : https uniquement, sans doublon, 24 maximum. */
export function cleanImages(urls: (string | undefined | null)[]): string[] {
  const out: string[] = [];
  for (const u of urls) {
    if (!u) continue;
    const url = u.trim().replace(/^http:\/\//i, "https://");
    if (!/^https:\/\/[^\s"'<>]+$/i.test(url) || out.includes(url)) continue;
    out.push(url);
    if (out.length === MAX_IMAGES) break;
  }
  return out;
}

export const EBAY_DOMAINS: Record<MarketplaceId, string> = {
  EBAY_US: "www.ebay.com", EBAY_CA: "www.ebay.ca", EBAY_GB: "www.ebay.co.uk", EBAY_AU: "www.ebay.com.au",
  EBAY_DE: "www.ebay.de", EBAY_FR: "www.ebay.fr", EBAY_IT: "www.ebay.it", EBAY_ES: "www.ebay.es", EBAY_IE: "www.ebay.ie",
};

/** Site eBay du pays (le site de test d'eBay quand l'app tourne en Sandbox). */
export function ebayDomain(marketId: string): string {
  return process.env.EBAY_ENV === "sandbox" ? "sandbox.ebay.com" : EBAY_DOMAINS[marketplace(marketId).id];
}

export function ebayItemUrl(marketId: string, listingId: string): string {
  return `https://${ebayDomain(marketId)}/itm/${encodeURIComponent(listingId)}`;
}

/** Pays de l'UE : une personne responsable (GPSR) est obligatoire. */
export const EU_MARKETS: MarketplaceId[] = ["EBAY_DE", "EBAY_FR", "EBAY_IT", "EBAY_ES", "EBAY_IE"];
export const isEuMarket = (id: string) => (EU_MARKETS as string[]).includes(id);

/** Début du jour (UTC) : sert au compteur d'annonces du jour. */
export function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Recherche eBay du produit (annonces en vente, triées par pertinence). */
export function ebaySearchUrl(marketId: string, keyword: string): string {
  return `https://${ebayDomain(marketId)}/sch/i.html?${new URLSearchParams({ _nkw: keyword })}`;
}

/** Fiche du produit sur le site CJdropshipping. */
/** Recherche eBay précise (annonces comparables) : mots-clés + catégorie + gamme de prix, neuf, achat immédiat. */
export function ebayPreciseSearchUrl(marketId: string, s: { q: string; categoryId?: string | null; priceMin?: number | null; priceMax?: number | null }): string {
  const p = new URLSearchParams({ _nkw: s.q, LH_BIN: "1", LH_ItemCondition: "1000" });
  if (s.categoryId) p.set("_sacat", s.categoryId);
  if (s.priceMin != null) p.set("_udlo", String(Math.floor(s.priceMin)));
  if (s.priceMax != null) p.set("_udhi", String(Math.ceil(s.priceMax)));
  return `https://${ebayDomain(marketId)}/sch/i.html?${p}`;
}

export function cjProductUrl(productId: string, title?: string | null): string {
  const slug = (title ?? "product").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80).replace(/^-+|-+$/g, "") || "product";
  return `https://cjdropshipping.com/product/${slug}-p-${encodeURIComponent(productId)}.html`;
}

/* ---------- Annonces à variantes (tailles, couleurs…) ---------- */

/** Variantes publiées au plus dans une même annonce (eBay en accepte 250 ; chacune coûte des appels fournisseur). */
export const MAX_LISTING_VARIANTS = 20;

const ASPECT_ALIASES: Record<string, string> = { colour: "Color", color: "Color", size: "Size", style: "Style", material: "Material", quantity: "Quantity" };

function aspectName(raw: string): string {
  const t = raw.replace(/\s+/g, " ").trim();
  const alias = ASPECT_ALIASES[t.toLowerCase()];
  return (alias ?? t.charAt(0).toUpperCase() + t.slice(1)).slice(0, 40);
}

/**
 * Options d'une variante fournisseur, pour eBay : noms (« Format-Quantity ») et valeurs (« L-1PCS ») de CJ,
 * associés un à un. Si ça ne colle pas (valeur qui contient un tiret…), une seule option « Option ».
 */
export function variantOptions(keyNames: string | undefined | null, variantKey: string | undefined | null, label: string): Record<string, string> {
  const names = (keyNames ?? "").split("-").map((n) => n.trim()).filter(Boolean);
  const values = (variantKey ?? "").split("-").map((v) => v.trim());
  if (names.length && names.length === values.length && values.every(Boolean)) {
    return Object.fromEntries(names.map((n, i) => [aspectName(n), values[i].slice(0, 65)]));
  }
  const value = (variantKey || label || "").replace(/\s+/g, " ").trim().slice(0, 65) || "Default";
  return { [names.length === 1 ? aspectName(names[0]) : "Option"]: value };
}

/**
 * Ce qui varie dans l'annonce (ex. Size : S, M, L), pour le groupe d'articles eBay.
 * Null si les variantes n'ont pas les mêmes options ou si deux variantes sont identiques.
 */
export function variationSpecs(options: Record<string, string>[]): { name: string; values: string[] }[] | null {
  if (!options.length) return null;
  const names = Object.keys(options[0]);
  if (!names.length || names.length > 5) return null;
  if (options.some((o) => Object.keys(o).length !== names.length || names.some((n) => !o[n]))) return null;
  const combos = new Set(options.map((o) => names.map((n) => o[n].toLowerCase()).join("\u0000")));
  if (combos.size !== options.length) return null;
  return names.map((name) => ({ name, values: [...new Set(options.map((o) => o[name]))] }));
}

/** Caractéristiques communes à toutes les variantes : sans celles qui varient (eBay refuse les doublons). */
export function withoutVariationAspects(aspects: Record<string, string[]>, names: string[]): Record<string, string[]> {
  const drop = new Set(names.map((n) => n.toLowerCase()));
  return Object.fromEntries(Object.entries(aspects).filter(([k]) => !drop.has(k.toLowerCase())));
}
