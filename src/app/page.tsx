import Link from "next/link";
import { PLANS } from "@/lib/plans";
import { getI18n } from "@/lib/i18n/server";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import PlanFeatures from "@/components/PlanFeatures";

export default async function Home() {
  const { locale, t } = await getI18n();
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex justify-end">
        <LanguageSwitcher locale={locale} label={t.common.language} />
      </div>
      <p className="mt-6 text-sm font-semibold uppercase tracking-wide text-blue-600">{t.home.kicker}</p>
      <h1 className="mt-3 text-4xl font-bold sm:text-5xl">{t.home.title}</h1>
      <p className="mt-4 max-w-2xl text-lg text-slate-600">{t.home.subtitle}</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/register" className="rounded-lg bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700">{t.home.ctaTrial}</Link>
        <Link href="/login" className="rounded-lg border border-slate-300 px-5 py-3 font-semibold hover:bg-white">{t.home.ctaLogin}</Link>
        <Link href="/ebay-profit-calculator" className="rounded-lg px-5 py-3 font-semibold text-blue-600 hover:underline">{t.home.ctaCalculator}</Link>
      </div>
      <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PLANS.map((p) => (
          <div key={p.id} className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold">{t.plans[p.id]}</h2>
            <p className="mt-2 text-3xl font-bold">
              ${p.priceUsd}
              <span className="text-base font-normal text-slate-500">{t.common.perMonth}</span>
            </p>
            <PlanFeatures plan={p} t={t.plans} />
          </div>
        ))}
      </div>
    </main>
  );
}
