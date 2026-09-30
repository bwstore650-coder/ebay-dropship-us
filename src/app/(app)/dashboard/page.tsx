import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmt, LOCALE_TAGS } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { marketplace } from "@/lib/marketplaces";
import type { OrderLine } from "@/lib/orders";
import { Icon } from "@/components/icons";
import { Notice, StatCard, StatusBadge } from "@/components/ui";
import { ORDER_TONE } from "@/lib/status-tones";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

export default async function Dashboard() {
  const user = await requireUser();
  const { locale, t } = await getI18n();
  const D = t.dashboard;
  const since = new Date(Date.now() - 30 * DAY);
  const [active, paused, drafts, orders30, recent, attention] = await Promise.all([
    db.listing.count({ where: { userId: user.id, status: "ACTIVE" } }),
    db.listing.count({ where: { userId: user.id, status: "PAUSED" } }),
    db.listing.count({ where: { userId: user.id, status: "DRAFT" } }),
    db.order.findMany({ where: { userId: user.id, createdAt: { gte: since } }, orderBy: { createdAt: "desc" } }),
    db.order.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 5 }),
    db.order.count({ where: { userId: user.id, status: { in: ["NEEDS_REVIEW", "FAILED"] } } }),
  ]);

  // Chiffre d'affaires et profit réel (après frais eBay et coût fournisseur), par devise.
  const sold = orders30.filter((o) => o.status === "ORDERED" || o.status === "SHIPPED");
  const byCurrency = new Map<string, { symbol: string; revenue: number; profit: number }>();
  for (const o of sold) {
    const c = byCurrency.get(o.currency) ?? { symbol: marketplace(o.marketplace).symbol, revenue: 0, profit: 0 };
    c.revenue += o.saleTotal ?? 0;
    c.profit += o.profit ?? 0;
    byCurrency.set(o.currency, c);
  }
  const currencies = [...byCurrency.values()].sort((a, b) => b.revenue - a.revenue);
  const main = currencies[0] ?? { symbol: marketplace(user.defaultMarketplace).symbol, revenue: 0, profit: 0 };
  const others = currencies.slice(1).map((c) => `${c.revenue.toFixed(0)} ${c.symbol}`).join(" · ");
  const money = (v: number) => new Intl.NumberFormat(LOCALE_TAGS[locale], { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) + " " + main.symbol;
  const avgMargin = main.revenue > 0 ? Math.round((main.profit / main.revenue) * 100) : null;

  const steps = [
    { done: user.plan !== "NONE", label: D.stepPlan, href: "/billing" },
    { done: user.ebayAccounts.length > 0, label: D.stepEbay, href: "/settings" },
    { done: user.supplierAccounts.length > 0, label: D.stepSupplier, href: "/settings" },
    { done: active + paused > 0, label: D.stepFirstListing, href: "/finder" },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const name = user.email.split("@")[0];

  return (
    <div className="space-y-8">
      {/* En-tête + recherche */}
      <section className="relative overflow-hidden rounded-3xl border border-line bg-surface px-6 py-8 sm:px-10 sm:py-10">
        <div className="pointer-events-none absolute -top-24 right-0 h-64 w-96 rounded-full bg-brand-500/20 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-24 left-10 h-48 w-72 rounded-full bg-fuchsia-500/10 blur-3xl" aria-hidden="true" />
        <div className="relative">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
                {fmt(D.greeting, { name: "" })}<span className="text-gradient">{name}</span>
              </h1>
              <p className="mt-1.5 text-sm text-muted">{D.subtitle}</p>
            </div>
            <span className={`badge ${user.autoOrder ? "bg-emerald-500/15 text-emerald-300" : "bg-surface-3 text-muted"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${user.autoOrder ? "animate-pulse bg-emerald-400" : "bg-subtle"}`} aria-hidden="true" />
              {user.autoOrder ? D.autoOn : D.autoOff}
            </span>
          </div>
          <form action="/finder" method="get" className="mt-7">
            <label htmlFor="q" className="eyebrow">{D.heroTitle}</label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Icon name="search" className="pointer-events-none absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2 text-subtle" />
                <input id="q" name="q" required minLength={2} placeholder={t.nav.searchPlaceholder} className="input h-12 rounded-xl pl-12 text-[15px]" />
              </div>
              <button className="btn-primary h-12 px-6">
                {t.nav.analyze}
                <Icon name="arrowRight" className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-xs text-subtle">{D.heroHint}</p>
          </form>
        </div>
      </section>

      {attention > 0 && (
        <Notice>
          <span className="flex flex-wrap items-center justify-between gap-2">
            {fmt(D.attention, { n: attention })}
            <Link href="/orders" className="font-semibold underline underline-offset-2">{D.seeOrders}</Link>
          </span>
        </Notice>
      )}

      {/* Chiffres clés */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label={D.activeListings} value={active} icon="tag" tone="brand" hint={paused ? `${paused} ${D.healthPaused.toLowerCase()}` : undefined} />
        <StatCard label={D.kpiOrders} value={orders30.length} icon="cart" tone="sky" />
        <StatCard label={D.kpiRevenue} value={money(main.revenue)} icon="dollar" tone="fuchsia" hint={others ? fmt(D.otherCurrencies, { list: others }) : undefined} />
        <StatCard
          label={D.kpiProfit}
          value={<span className={main.profit < 0 ? "text-red-300" : "text-emerald-300"}>{money(main.profit)}</span>}
          icon="trend"
          tone="emerald"
          hint={avgMargin !== null ? `${D.kpiMargin} : ${avgMargin} %` : undefined}
        />
      </section>

      <section className="grid grid-cols-1 items-start gap-6 lg:grid-cols-5">
        {/* Dernières commandes */}
        <div className="card p-0 lg:col-span-3">
          <div className="flex items-center justify-between px-6 pt-5 pb-3">
            <h2 className="font-semibold text-fg">{D.recentTitle}</h2>
            <Link href="/orders" className="inline-flex items-center gap-1 text-sm font-medium text-brand-300 hover:text-brand-200">
              {D.viewAll} <Icon name="arrowRight" className="h-3.5 w-3.5" />
            </Link>
          </div>
          {recent.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted">{D.noOrders}</p>
          ) : (
            <ul className="divide-y divide-line">
              {recent.map((o) => {
                const m = marketplace(o.marketplace);
                const lines = (o.lines as unknown as OrderLine[]) ?? [];
                return (
                  <li key={o.id} className="flex items-center gap-4 px-5 py-3.5 sm:px-6">
                    <span className="hidden h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-subtle ring-1 ring-line sm:grid">
                      <Icon name="box" className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-fg">{lines[0] ? `${lines[0].quantity} × ${lines[0].title}` : o.ebayOrderId}</p>
                      <p className="text-xs text-subtle">{(o.ebayCreatedAt ?? o.createdAt).toLocaleDateString(LOCALE_TAGS[locale])} · {t.markets[m.id]}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-semibold tabular-nums ${o.profit !== null && o.profit < 0 ? "text-red-300" : "text-emerald-300"}`}>
                        {o.profit !== null ? `${o.profit > 0 ? "+" : ""}${o.profit.toFixed(2)} ${m.symbol}` : "—"}
                      </p>
                      <StatusBadge tone={ORDER_TONE[o.status]}>{t.orders.status[o.status]}</StatusBadge>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Démarrage ou santé des annonces */}
        <div className="space-y-6 lg:col-span-2">
          {doneCount < steps.length ? (
            <div className="card">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-fg">{D.onboarding}</h2>
                <span className="text-xs text-muted">{fmt(D.progress, { done: doneCount, total: steps.length })}</span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3">
                <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-fuchsia-500" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
              </div>
              <ul className="mt-4 space-y-1">
                {steps.map((s) => (
                  <li key={s.label}>
                    {s.done ? (
                      <span className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-subtle line-through decoration-subtle/60">
                        <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-500/20 text-emerald-300"><Icon name="check" className="h-3 w-3" strokeWidth={3} /></span>
                        {s.label}
                      </span>
                    ) : (
                      <Link href={s.href} className="group flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-fg-2 hover:bg-surface-2 hover:text-fg">
                        <span className="h-5 w-5 rounded-full border-2 border-line-strong group-hover:border-brand-400" />
                        <span className="flex-1">{s.label}</span>
                        <Icon name="arrowRight" className="h-4 w-4 text-subtle opacity-0 transition group-hover:opacity-100" />
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="card">
              <h2 className="font-semibold text-fg">{D.healthTitle}</h2>
              <p className="mt-1 text-xs text-subtle">{D.allSet}</p>
              <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
                {[
                  [D.healthActive, active, "text-emerald-300"],
                  [D.healthPaused, paused, "text-amber-300"],
                  [D.healthDraft, drafts, "text-fg-2"],
                ].map(([label, value, color]) => (
                  <div key={label as string} className="rounded-xl bg-surface-2 px-2 py-3 ring-1 ring-line">
                    <dd className={`text-xl font-semibold tabular-nums ${color}`}>{value}</dd>
                    <dt className="mt-0.5 text-[11px] leading-tight text-subtle">{label}</dt>
                  </div>
                ))}
              </dl>
            </div>
          )}

          <div className="card">
            <h2 className="font-semibold text-fg">{D.quickTitle}</h2>
            <ul className="mt-3 space-y-1">
              {([
                ["/finder", D.quickFind, "search"],
                ["/listings", D.quickListings, "tag"],
                ["/settings", D.quickAuto, "zap"],
              ] as const).map(([href, label, icon]) => (
                <li key={href}>
                  <Link href={href} className="group flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-fg-2 hover:bg-surface-2 hover:text-fg">
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-surface-2 text-brand-300 ring-1 ring-line group-hover:ring-brand-500/40">
                      <Icon name={icon} className="h-4 w-4" />
                    </span>
                    <span className="flex-1">{label}</span>
                    <Icon name="arrowRight" className="h-4 w-4 text-subtle transition group-hover:translate-x-0.5 group-hover:text-fg-2" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
