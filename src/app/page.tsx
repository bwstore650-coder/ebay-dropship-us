import Link from "next/link";
import { PLANS } from "@/lib/plans";
import { BRAND } from "@/lib/brand";
import { fmt } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import Pricing from "@/components/landing/Pricing";

/** Icônes simples (traits) pour les 6 fonctionnalités, dans le même ordre que le dictionnaire. */
const FEATURE_ICONS = [
  "M3 12h4l3 8 4-16 3 8h4", // marge
  "M4 19V9m6 10V5m6 14v-7m4 7H2", // ventes réelles
  "M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7l8-4z", // protection
  "M3 7h13l-2-3M21 17H8l2 3M16 7l3 3-3 3M8 17l-3-3 3-3", // commandes auto
  "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10 3a3 3 0 100-6 3 3 0 000 6z", // surveillance
  "M12 2a10 10 0 100 20 10 10 0 000-20zm-9 10h18M12 2c3 3 3 17 0 20M12 2c-3 3-3 17 0 20", // pays
];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export default async function Home() {
  const { locale, t } = await getI18n();
  const L = t.landing;
  const b = { brand: BRAND.name };

  return (
    <>
      <SiteHeader locale={locale} t={t} />
      <main>
        {/* HERO */}
        <section className="relative overflow-hidden bg-slate-950 text-white">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_20%_0%,rgba(99,102,241,0.35),transparent),radial-gradient(40%_40%_at_90%_30%,rgba(16,185,129,0.18),transparent)]" />
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 lg:grid-cols-2 lg:py-28">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-slate-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {L.hero.badge}
              </span>
              <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
                {L.hero.title1}{" "}
                <span className="bg-gradient-to-r from-brand-300 to-emerald-300 bg-clip-text text-transparent">{L.hero.title2}</span>
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-300">{fmt(L.hero.subtitle, b)}</p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="/register" className="btn-primary text-base">{L.hero.cta}</Link>
                <Link href="/ebay-profit-calculator" className="inline-flex items-center justify-center rounded-lg border border-white/20 px-5 py-3 font-semibold text-white transition hover:bg-white/10">
                  {L.hero.secondary}
                </Link>
              </div>
              <p className="mt-5 text-sm text-slate-400">{L.hero.reassurance}</p>
            </div>

            {/* Carte d'analyse (chiffres réels de notre test) */}
            <div className="relative">
              <div className="rounded-2xl border border-white/10 bg-white p-6 text-slate-900 shadow-2xl shadow-brand-900/40">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{L.mock.title}</p>
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">48%</span>
                </div>
                <p className="mt-2 text-xl font-semibold">{L.mock.product}</p>
                <dl className="mt-5 space-y-3 text-sm">
                  {[
                    [L.mock.market, "$30.75", ""],
                    [L.mock.cost, "− $11.45", "text-slate-600"],
                    [L.mock.fees, "− $4.58", "text-slate-600"],
                  ].map(([label, value, cls]) => (
                    <div key={label} className="flex justify-between">
                      <dt className="text-slate-500">{label}</dt>
                      <dd className={`font-medium tabular-nums ${cls}`}>{value}</dd>
                    </div>
                  ))}
                  <div className="flex justify-between border-t border-slate-100 pt-3">
                    <dt className="font-semibold">{L.mock.profit}</dt>
                    <dd className="text-lg font-bold tabular-nums text-emerald-600">+ $14.72</dd>
                  </div>
                </dl>
                <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">✓ {L.mock.verdict}</p>
                <div className="mt-3 flex items-center justify-between rounded-lg bg-red-50 px-3 py-2 text-sm">
                  <span className="font-medium text-red-800">{L.mock.rejected}</span>
                  <span className="text-red-700">{L.mock.rejectedNote}</span>
                </div>
              </div>
              <p className="mt-3 text-center text-xs text-slate-400">{L.mock.caption}</p>
            </div>
          </div>
        </section>

        {/* PREUVES */}
        <section className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-6xl px-4 py-14">
            <p className="text-center text-sm font-semibold uppercase tracking-wide text-slate-500">{L.proof.title}</p>
            <div className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {L.proof.items.map((it) => (
                <div key={it.value} className="text-center">
                  <p className="text-3xl font-bold tracking-tight text-brand-600">{it.value}</p>
                  <p className="mt-2 text-sm text-slate-600">{it.label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* PROBLÈME */}
        <section className="mx-auto max-w-6xl px-4 py-20">
          <h2 className="mx-auto max-w-2xl text-center text-3xl font-bold tracking-tight sm:text-4xl">{L.problem.title}</h2>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {L.problem.items.map((it) => (
              <div key={it.title} className="card">
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-red-50 text-red-600">
                  <Icon d="M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
                </span>
                <h3 className="mt-4 text-lg font-semibold">{it.title}</h3>
                <p className="mt-2 text-slate-600">{it.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* COMMENT ÇA MARCHE */}
        <section id="how" className="scroll-mt-20 bg-white py-20">
          <div className="mx-auto max-w-6xl px-4">
            <h2 className="mx-auto max-w-2xl text-center text-3xl font-bold tracking-tight sm:text-4xl">{L.how.title}</h2>
            <ol className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
              {L.how.steps.map((s, i) => (
                <li key={s.title} className="relative rounded-2xl border border-slate-200 p-6">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-600 text-sm font-bold text-white">{i + 1}</span>
                  <h3 className="mt-4 font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm text-slate-600">{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* FONCTIONNALITÉS */}
        <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20">
          <h2 className="mx-auto max-w-2xl text-center text-3xl font-bold tracking-tight sm:text-4xl">{L.features.title}</h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {L.features.items.map((f, i) => (
              <div key={f.title} className="card">
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-600">
                  <Icon d={FEATURE_ICONS[i] ?? FEATURE_ICONS[0]} />
                </span>
                <h3 className="mt-4 font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm text-slate-600">{f.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* COMPARAISON */}
        <section className="bg-white py-20">
          <div className="mx-auto max-w-4xl px-4">
            <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">{L.compare.title}</h2>
            <div className="mt-10 overflow-x-auto rounded-2xl border border-slate-200">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-5 py-3 font-medium"><span className="sr-only">—</span></th>
                    <th className="px-5 py-3 font-medium">{L.compare.colTypical}</th>
                    <th className="px-5 py-3 font-semibold text-brand-700">{fmt(L.compare.colUs, b)}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {L.compare.rows.map((r) => (
                    <tr key={r.label}>
                      <th scope="row" className="px-5 py-4 font-medium text-slate-900">{r.label}</th>
                      <td className="px-5 py-4 text-slate-500">{r.typical}</td>
                      <td className="px-5 py-4 font-semibold text-emerald-700">✓ {r.us}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* TARIFS */}
        <section id="pricing" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{L.pricing.title}</h2>
            <p className="mt-3 text-slate-600">{L.pricing.subtitle}</p>
          </div>
          <div className="mt-10">
            <Pricing plans={PLANS} t={L.pricing} tb={t.billing} tp={t.plans} perMonth={t.common.perMonth} />
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-20 bg-white py-20">
          <div className="mx-auto max-w-3xl px-4">
            <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">{L.faq.title}</h2>
            <div className="mt-10 divide-y divide-slate-200 rounded-2xl border border-slate-200">
              {L.faq.items.map((f) => (
                <details key={f.q} className="group px-6 py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <span className="text-slate-400 transition group-open:rotate-45" aria-hidden="true">+</span>
                  </summary>
                  <p className="mt-3 text-slate-600">{fmt(f.a, b)}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* APPEL FINAL */}
        <section className="px-4 py-20">
          <div className="mx-auto max-w-5xl rounded-3xl bg-slate-950 px-6 py-14 text-center text-white sm:px-12">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{L.finalCta.title}</h2>
            <p className="mx-auto mt-4 max-w-xl text-slate-300">{L.finalCta.text}</p>
            <Link href="/register" className="btn-primary mt-8 text-base">{L.finalCta.cta}</Link>
            <p className="mt-4 text-sm text-slate-400">{L.hero.reassurance}</p>
          </div>
        </section>
      </main>
      <SiteFooter locale={locale} t={t} />
    </>
  );
}
