/** Traductions : anglais (par défaut), français, allemand, italien, espagnol. Sans dépendance serveur (utilisable partout). */
import { en, type Dict } from "./dictionaries/en";
import { fr } from "./dictionaries/fr";
import { de } from "./dictionaries/de";
import { it } from "./dictionaries/it";
import { es } from "./dictionaries/es";

export type { Dict };
export const LOCALES = ["en", "fr", "de", "it", "es"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "lang";

export const LOCALE_NAMES: Record<Locale, string> = { en: "English", fr: "Français", de: "Deutsch", it: "Italiano", es: "Español" };
/** Format régional des dates et nombres. */
export const LOCALE_TAGS: Record<Locale, string> = { en: "en-US", fr: "fr-FR", de: "de-DE", it: "it-IT", es: "es-ES" };

const DICTS: Record<Locale, Dict> = { en, fr, de, it, es };

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

export function getDict(locale: Locale): Dict {
  return DICTS[locale];
}

/** Choisit la langue : cookie « lang », sinon l'en-tête Accept-Language du navigateur, sinon l'anglais. */
export function pickLocale(cookieValue: string | undefined, acceptLanguage: string | null | undefined): Locale {
  if (isLocale(cookieValue)) return cookieValue;
  const wanted = (acceptLanguage ?? "")
    .split(",")
    .map((part) => {
      const [tag, q] = part.trim().split(";q=");
      return { lang: tag.toLowerCase().split("-")[0], q: q ? Number(q) : 1 };
    })
    .filter((x) => x.lang && Number.isFinite(x.q))
    .sort((a, b) => b.q - a.q);
  const found = wanted.find((w) => isLocale(w.lang));
  return found && isLocale(found.lang) ? found.lang : DEFAULT_LOCALE;
}

/** Remplace {cle} par sa valeur : fmt("{n} annonces", { n: 50 }). */
export function fmt(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}
