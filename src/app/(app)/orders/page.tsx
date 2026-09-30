import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmt, LOCALE_TAGS } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { marketplace } from "@/lib/marketplaces";
import type { OrderLine } from "@/lib/orders";
import { forceOrder, markHandled, syncNow } from "./actions";
import { Icon } from "@/components/icons";
import { Notice, PageHeader, StatusBadge } from "@/components/ui";
import { ORDER_TONE } from "@/lib/status-tones";

export const dynamic = "force-dynamic";


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
      <PageHeader
        title={O.title}
        subtitle={user.autoOrder ? O.introAuto : O.introManual}
        actions={
          <form action={syncNow}>
            <button className="btn-secondary px-4 py-2 text-sm"><Icon name="refresh" className="h-4 w-4" />{O.sync}</button>
          </form>
        }
      />

      {attention > 0 && <Notice>{fmt(O.attention, { n: attention })}</Notice>}

      {orders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface/50 p-12 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-brand-500/12 text-brand-300"><Icon name="box" /></span>
          <p className="mx-auto mt-4 max-w-md text-sm text-muted">{O.empty}</p>
          <Link href="/finder" className="btn-primary mt-5 px-4 py-2 text-sm">{t.nav.finder}</Link>
        </div>
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
              <div key={o.id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-subtle">
                      {O.colOrder} {o.ebayOrderId} · {(o.ebayCreatedAt ?? o.createdAt).toLocaleDateString(LOCALE_TAGS[locale])} · {t.markets[m.id]}
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {lines.map((l) => (
                        <li key={l.lineItemId} className="font-medium text-fg">{l.quantity} × {l.title}</li>
                      ))}
                    </ul>
                  </div>
                  <StatusBadge tone={ORDER_TONE[o.status]}>{O.status[o.status]}</StatusBadge>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-line text-sm ring-1 ring-line sm:grid-cols-4">
                  <div className="bg-surface-2 px-3 py-2.5"><dt className="text-xs text-subtle">{O.colSale}</dt><dd className="font-medium tabular-nums">{money(o.saleTotal)}</dd></div>
                  <div className="bg-surface-2 px-3 py-2.5"><dt className="text-xs text-subtle">{O.colCost}</dt><dd className="font-medium tabular-nums">{money(o.supplierCost)}</dd></div>
                  <div className="bg-surface-2 px-3 py-2.5">
                    <dt className="text-xs text-subtle">{O.colProfit}</dt>
                    <dd className={`font-semibold tabular-nums ${o.profit !== null && o.profit < 0 ? "text-red-300" : "text-emerald-300"}`}>{money(o.profit)}</dd>
                  </div>
                  <div className="bg-surface-2 px-3 py-2.5"><dt className="text-xs text-subtle">{O.colTracking}</dt><dd className="truncate font-medium text-fg">{o.trackingNumber ? `${o.carrier ?? ""} ${o.trackingNumber}` : "—"}</dd></div>
                </dl>
                {why && <p className={`mt-3 rounded-lg px-3 py-2 text-sm ${o.status === "CANCELLED" ? "bg-surface-2 text-muted" : "bg-amber-500/10 text-amber-200"}`}>{why}</p>}
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
