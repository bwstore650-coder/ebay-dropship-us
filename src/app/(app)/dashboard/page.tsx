import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getI18n } from "@/lib/i18n/server";

export default async function Dashboard() {
  const user = await requireUser();
  const { t } = await getI18n();
  const [listings, orders] = await Promise.all([
    db.listing.count({ where: { userId: user.id, status: "ACTIVE" } }),
    db.order.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const profitUsd = orders
    .filter((o: { currency: string }) => o.currency === "USD")
    .reduce((s: number, o: { saleTotal: number; supplierCost: number | null }) => s + (o.saleTotal - (o.supplierCost ?? 0)), 0);
  const steps = [
    { done: user.plan !== "NONE", label: t.dashboard.stepPlan, href: "/billing" },
    { done: user.ebayAccounts.length > 0, label: t.dashboard.stepEbay, href: "/settings" },
    { done: user.supplierAccounts.length > 0, label: t.dashboard.stepSupplier, href: "/settings" },
    { done: listings > 0, label: t.dashboard.stepFirstListing, href: "/finder" },
  ];
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t.dashboard.title}</h1>
        {user.plan !== "NONE" && (
          <Link href="/review" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50">
            ★ {t.review.dashboardCta}
          </Link>
        )}
      </div>
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
        <h2 className="font-semibold">{t.dashboard.onboarding}</h2>
        <ul className="mt-3 space-y-2">
          {steps.map((s) => (
            <li key={s.label} className="flex items-center gap-2">
              <span className={s.done ? "text-green-600" : "text-slate-400"}>{s.done ? "✓" : "○"}</span>
              {s.done ? s.label : <Link className="text-brand-600" href={s.href}>{s.label}</Link>}
            </li>
          ))}
        </ul>
      </section>
      <section className="grid gap-4 sm:grid-cols-3">
        <Stat label={t.dashboard.activeListings} value={listings} />
        <Stat label={t.dashboard.recentOrders} value={orders.length} />
        <Stat label={t.dashboard.profitUsd} value={`$${profitUsd.toFixed(2)}`} />
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}
