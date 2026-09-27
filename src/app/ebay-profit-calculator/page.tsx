import type { Metadata } from "next";
import ProfitCalculator from "@/components/ProfitCalculator";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { getI18n } from "@/lib/i18n/server";
import { MARKETPLACE_IDS } from "@/lib/marketplaces";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.calculator.metaTitle, description: t.calculator.metaDescription };
}

const DEFAULT_SITE = { en: "EBAY_US", fr: "EBAY_FR", de: "EBAY_DE", it: "EBAY_IT", es: "EBAY_ES" } as const;

export default async function Page() {
  const { locale, t } = await getI18n();
  const c = t.calculator;
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex justify-end">
        <LanguageSwitcher locale={locale} label={t.common.language} />
      </div>
      <p className="mt-4 text-sm font-semibold uppercase tracking-wide text-blue-600">{c.kicker}</p>
      <h1 className="mt-2 text-3xl font-bold sm:text-4xl">{c.title}</h1>
      <p className="mt-3 text-slate-600">{c.intro}</p>
      <ProfitCalculator t={c} markets={t.markets} errors={t.errors} marketIds={MARKETPLACE_IDS} defaultMarket={DEFAULT_SITE[locale]} />
    </main>
  );
}
