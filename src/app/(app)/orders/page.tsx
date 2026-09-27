import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmt, LOCALE_TAGS } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { marketplace } from "@/lib/marketplaces";
import type { OrderLine } from "@/lib/orders";
import { forceOrder, markHandled, syncNow } from "./actions";

export const dynamic = "force-dynamic";

const BADGE = {
  PENDING: "bg-slate-100 text-slate-700",
  ORDERING: "bg-sky-100 text-sky-800",
  ORDERED: "bg-brand-100 text-brand-800",
  SHIPPED: "bg-emerald-100 text-emerald-800",
  NEEDS_REVIEW: "bg-amber-100 text-amber-800",
  FAILED: "bg-red-100 text-red-700",
  CANCELLED: "bg-slate-200 text-slate-600",
} as const;

export default async function OrdersPage() {
  const user = await requireUser();
  const { locale, t } = await getI18n();
  const O = t.orders;
  const orders = await db.order.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 200 });
  const attention = orders.filter((o) => o.status === "NEEDS_REVIEW" || o.status === "FAILED").length;
  const reason = (code: string | null, detail: string | null) =>
    code ? fmt((O.reasons as Record<string, string>)[code] ?? O.reasons.UNKNOWN, { detail: detail ?? "" }) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{O.title}</h1>
          <p className="mt-1 text-sm text-slate-600">{user.autoOrder ? O.introAuto : O.introManual}</p>
        </div>
        <form action={syncNow}>
          <button className="btn-secondary px-4 py-2 text-sm">{O.sync}</button>
        </form>
      </div>

      {attention > 0 && <p className="rounded-lg bg-amber-50 p-3 text-sm font-medium text-amber-800">{fmt(O.attention, { n: attention })}</p>}

      {orders.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
          {O.empty} <Link href="/finder" className="font-medium text-brand-600 hover:underline">{t.nav.finder}</Link>
        </p>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => {
            const m = marketplace(o.marketplace);
            const lines = (o.lines as unknown as OrderLine[]) ?? [];
            const money = (v: number | null) => (v === null ? "—" : `${v.toFixed(2)} ${m.symbol}`);
            const why = reason(o.errorCode, o.errorMessage);
            const canForce = o.status === "NEEDS_REVIEW" || o.status === "FAILED" || (o.status === "PENDING" && !user.autoOrder);
            const canHandle = o.status === "NEEDS_REVIEW" || o.status === "FAILED" || o.status === "PENDING";
            return (
              <div key={o.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-slate-500">
                      {O.colOrder} {o.ebayOrderId} · {(o.ebayCreatedAt ?? o.createdAt).toLocaleDateString(LOCALE_TAGS[locale])} · {t.markets[m.id]}
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {lines.map((l) => (
                        <li key={l.lineItemId} className="font-medium text-slate-900">{l.quantity} × {l.title}</li>
                      ))}
                    </ul>
                  </div>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${BADGE[o.status]}`}>{O.status[o.status]}</span>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div><dt className="text-slate-500">{O.colSale}</dt><dd className="font-medium tabular-nums">{money(o.saleTotal)}</dd></div>
                  <div><dt className="text-slate-500">{O.colCost}</dt><dd className="font-medium tabular-nums">{money(o.supplierCost)}</dd></div>
                  <div>
                    <dt className="text-slate-500">{O.colProfit}</dt>
                    <dd className={`font-semibold tabular-nums ${o.profit !== null && o.profit < 0 ? "text-red-600" : "text-emerald-700"}`}>{money(o.profit)}</dd>
                  </div>
                  <div><dt className="text-slate-500">{O.colTracking}</dt><dd className="font-medium">{o.trackingNumber ? `${o.carrier ?? ""} ${o.trackingNumber}` : "—"}</dd></div>
                </dl>
                {why && <p className={`mt-3 rounded-lg p-2 text-sm ${o.status === "CANCELLED" ? "bg-slate-50 text-slate-600" : "bg-amber-50 text-amber-800"}`}>{why}</p>}
                {(canForce || canHandle) && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {canForce && (
                      <form action={forceOrder}>
                        <input type="hidden" name="orderId" value={o.id} />
                        <button className="btn-primary px-3 py-1.5 text-sm">{o.errorCode === "LOSS" ? O.forceLoss : O.orderNow}</button>
                      </form>
                    )}
                    {canHandle && (
                      <form action={markHandled}>
                        <input type="hidden" name="orderId" value={o.id} />
                        <button className="btn-secondary px-3 py-1.5 text-sm">{O.markHandled}</button>
                      </form>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
