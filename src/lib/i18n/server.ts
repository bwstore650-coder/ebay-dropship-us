import { cookies, headers } from "next/headers";
import { getDict, LOCALE_COOKIE, pickLocale, type Dict, type Locale } from "./index";

/** Langue et dictionnaire de la requête en cours (composants serveur et routes API). */
export async function getI18n(): Promise<{ locale: Locale; t: Dict }> {
  const locale = pickLocale((await cookies()).get(LOCALE_COOKIE)?.value, (await headers()).get("accept-language"));
  return { locale, t: getDict(locale) };
}
