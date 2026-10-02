/**
 * Fonctions pures de l'extension (testées avec vitest) : aucune dépendance au navigateur.
 */

/** Identifiant produit CJ d'une adresse de page CJdropshipping, ou null. */
export function cjProductIdFromUrl(href) {
  let u;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  if (!/(^|\.)cjdropshipping\.com$/.test(u.hostname)) return null;
  const valid = (v) => (v && /^[A-Za-z0-9-]{6,64}$/.test(v) ? v : null);
  // Format habituel : /product/<nom-du-produit>-p-<identifiant>.html
  const path = decodeURIComponent(u.pathname);
  if (path.startsWith("/product/") && path.endsWith(".html")) {
    const i = path.lastIndexOf("-p-");
    if (i > 0) return valid(path.slice(i + 3, -5));
  }
  // Ancien format : …?id=<identifiant>
  if (/product/i.test(path)) return valid(u.searchParams.get("id") ?? u.searchParams.get("pid"));
  return null;
}

/** Sites eBay pris en charge (même liste que Sellvela). */
export const EBAY_HOSTS = ["www.ebay.com", "www.ebay.ca", "www.ebay.co.uk", "www.ebay.com.au", "www.ebay.de", "www.ebay.fr", "www.ebay.it", "www.ebay.es", "www.ebay.ie"];

/** Numéro d'annonce d'une fiche produit eBay (/itm/123… ou /itm/titre/123…) et son site, ou null. */
export function ebayItemFromUrl(href) {
  let u;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (!EBAY_HOSTS.includes(host)) return null;
  const m = u.pathname.match(/^\/itm\/(?:[^/]+\/)?(\d{8,15})(?:[/?#]|$)/);
  return m ? { itemId: m[1], host } : null;
}

/** Langue de l'interface : celle du compte Sellvela, sinon celle du navigateur, sinon l'anglais. */
export const LOCALES = ["en", "fr", "es", "de", "it"];
export function pickLocale(accountLocale, browserLanguage) {
  for (const l of [accountLocale, browserLanguage]) {
    const short = typeof l === "string" ? l.slice(0, 2).toLowerCase() : "";
    if (LOCALES.includes(short)) return short;
  }
  return "en";
}

/** Remplace {nom} par la valeur. */
export function fill(text, vars = {}) {
  return String(text).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** Montant lisible (ex. « $12.50 », « 12,50 € »). */
export function money(value, currency = "USD", locale = "en") {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(Number(value));
  } catch {
    return `${Number(value).toFixed(2)} ${currency}`;
  }
}

/** Texte et couleur du badge de l'icône : commandes à vérifier, sinon « ! » si le solde CJ est bas. */
export function badgeFor(summary) {
  if (!summary) return { text: "", color: "#6d6af8" };
  const n = summary.counts?.ordersToCheck ?? 0;
  if (n > 0) return { text: n > 99 ? "99+" : String(n), color: "#dc2626" };
  if (summary.cj?.low) return { text: "!", color: "#d97706" };
  return { text: "", color: "#6d6af8" };
}

/** Événements pas encore notifiés (et liste des identifiants déjà vus, bornée). */
export function newEvents(events, seenIds, max = 300) {
  const seen = new Set(seenIds ?? []);
  const fresh = (events ?? []).filter((e) => e && typeof e.id === "string" && !seen.has(e.id));
  const ids = [...fresh.map((e) => e.id), ...(seenIds ?? [])].slice(0, max);
  return { fresh, ids };
}

/** Faut-il (re)prévenir que le solde CJ est bas ? */
export function shouldWarnLowBalance(summary, lastWarnedAt, now, everyMs) {
  if (!summary?.cj?.low) return false;
  return !lastWarnedAt || now - lastWarnedAt >= everyMs;
}

/** Étapes de démarrage restantes. */
export function onboardingLeft(o) {
  if (!o) return [];
  return ["plan", "ebay", "supplier", "firstListing"].filter((k) => !o[k]);
}

/** Fiche du produit sur CJdropshipping (même format que le site Sellvela). */
export function cjProductUrl(productId, title) {
  const slug = String(title ?? "product").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80).replace(/^-+|-+$/g, "") || "product";
  return `https://cjdropshipping.com/product/${slug}-p-${encodeURIComponent(productId)}.html`;
}

/** Clé du texte d'erreur à afficher pour un code renvoyé par Sellvela. */
export function errorKey(code) {
  return (
    {
      EBAY_QUOTA: "errQuota",
      PLAN_REQUIRED: "errPlan",
      CJ_REQUIRED: "errCj",
      RATE_LIMITED: "errRate",
      EXT_UNAUTHORIZED: "errAuth",
      SAVED_FULL: "errFull",
      SNIPE_RUNNING: "errRunning",
      AI_LIMIT: "errAiLimit",
      AI_FAILED: "errAiFailed",
      AI_NOT_CONFIGURED: "errAiOff",
      NOT_FOUND: "errItemNotFound",
      FEATURE_OFF: "errFeatureOff",
    }[code] ?? "errGeneric"
  );
}

/** Jeton Sellvela de l'extension (format « svx_… »). */
export const isToken = (v) => typeof v === "string" && /^svx_[A-Za-z0-9_-]{20,120}$/.test(v);

/** Adresse sûre à ouvrir : seulement Sellvela ou CJdropshipping, en https. */
export function safeUrl(href, apiBase) {
  try {
    const u = new URL(href);
    const base = new URL(apiBase);
    if (u.protocol !== "https:") return null;
    if (u.origin === base.origin || /(^|\.)cjdropshipping\.com$/.test(u.hostname)) return u.toString();
  } catch {
    /* adresse invalide */
  }
  return null;
}
