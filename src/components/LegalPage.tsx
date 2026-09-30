import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { BRAND } from "@/lib/brand";
import { fmt, LOCALE_TAGS } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { LEGAL, LEGAL_UPDATED, type LegalDoc } from "@/lib/legal";

export async function legalMetadata(doc: LegalDoc): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.legal[doc]} — ${BRAND.name}` };
}

/** Page légale : version anglaise (référence) ou française ; les autres langues affichent l'anglais. */
export default async function LegalPage({ doc }: { doc: LegalDoc }) {
  const { locale, t } = await getI18n();
  const lang = locale === "fr" ? "fr" : "en";
  const sections = LEGAL[doc][lang];
  const vars = { brand: BRAND.name, company: BRAND.company, email: BRAND.supportEmail };
  const date = new Date(`${LEGAL_UPDATED}T12:00:00Z`).toLocaleDateString(LOCALE_TAGS[locale], { dateStyle: "long" });
  return (
    <>
      <SiteHeader locale={locale} t={t} />
      <main className="mx-auto max-w-3xl px-4 py-12" lang={lang}>
        <h1 className="text-3xl font-bold tracking-tight">{t.legal[doc]}</h1>
        <p className="mt-2 text-sm text-muted">{fmt(t.legal.updated, { date })}</p>
        {locale !== "en" && <p className="mt-4 rounded-lg bg-surface-2 p-3 text-sm text-muted">{t.legal.englishPrevails}</p>}
        <div className="mt-8 space-y-8">
          {sections.map((s) => (
            <section key={s.h}>
              <h2 className="text-lg font-semibold">{s.h}</h2>
              {s.p.map((para) => (
                <p key={para.slice(0, 40)} className="mt-2 leading-relaxed text-fg-2">{fmt(para, vars)}</p>
              ))}
            </section>
          ))}
        </div>
      </main>
      <SiteFooter locale={locale} t={t} />
    </>
  );
}
