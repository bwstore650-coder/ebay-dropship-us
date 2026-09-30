import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmt, LOCALE_TAGS } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { ebayDomain } from "@/lib/listing";
import { marketplace } from "@/lib/marketplaces";
import { actionsFor } from "@/lib/aftersale";
import { ORDER_TONE } from "@/lib/status-tones";
import { Icon } from "@/components/icons";
import { Notice, PageHeader, StatusBadge } from "@/components/ui";
import { acceptReturnAction, approveCancelAction, cancelSupplierAction, syncReturnsAction } from "./actions";

export const dynamic = "force-dynamic";

const humanize = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export default async function ReturnsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  const { locale, t } = await getI18n();
  const R = t.returns;
  const { error } = await searchParams;
  const rows = await db.afterSale.findMany({
    where: { userId: user.id, OR: [{ open: true }, { updatedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }] },
    orderBy: [{ open: "desc" }, { requestedAt: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  const orders = await db.order.findMany({ where: { id: { in: rows.map((r) => r.orderId).filter((x): x is string => Boolean(x)) } } });
  const byId = new Map(orders.map((o) => [o.id, o]));
  const open = rows.filter((r) => r.open);
  const closed = rows.filter((r) => !r.open);

  const card = (a: (typeof rows)[number]) => {
    const order = a.orderId ? byId.get(a.orderId) ?? null : null;
    const can = actionsFor(a, order);
    const m = marketplace(a.marketplace);
    const domain = ebayDomain(m.id);
    const ebayUrl = a.type === "RETURN" ? `https://${domain}/rt/ReturnDetails?returnId=${encodeURIComponent(a.ebayId)}` : `https://${domain}/sh/ord/details?orderid=${encodeURIComponent(a.ebayOrderId)}`;
    const lines = (order?.lines as unknown as { title?: string }[] | undefined) ?? [];
    const title = a.itemTitle ?? lines[0]?.title ?? a.ebayOrderId;
    return (
      <article key={a.id} className={`card p-5 ${a.open && !a.action ? "border-amber-500/30" : ""}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-xs text-subtle">
              <span className={`badge ${a.type === "RETURN" ? "bg-sky-500/15 text-sky-300" : "bg-fuchsia-500/15 text-fuchsia-300"}`}>
                <Icon name={a.type === "RETURN" ? "undo" : "close"} className="h-3 w-3" />{a.type === "RETURN" ? R.typeRETURN : R.typeCANCEL}
              </span>
              {a.ebayOrderId} · {(a.requestedAt ?? a.createdAt).toLocaleDateString(LOCALE_TAGS[locale])} · {t.markets[m.id]}
            </p>
            <p className="mt-1.5 font-medium text-fg">{title}</p>
            <p className="mt-1 text-sm text-muted">
              {(a.reason && (R.reasons as Record<string, string>)[a.reason]) ?? (a.reason ? humanize(a.reason) : "")}
              {a.amount !== null && ` · ${fmt(R.amount, { amount: `${a.amount.toFixed(2)} ${a.currency ?? m.currency}` })}`}
            </p>
            {a.buyerComment && <p className="mt-1 text-sm text-fg-2 italic">{fmt(R.buyerSays, { comment: a.buyerComment })}</p>}
          </div>
          <StatusBadge tone={a.open ? (a.action ? "brand" : "amber") : "neutral"}>{a.open ? (a.action ? (R.actions as Record<string, string>)[a.action] ?? a.action : R.open) : R.closed}</StatusBadge>
        </div>
        <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-subtle">
          {order ? (
            <>
              {fmt(R.yourOrder, { status: "" })}
              <StatusBadge tone={ORDER_TONE[order.status]}>{t.orders.status[order.status]}</StatusBadge>
              {order.trackingNumber && <span>{order.carrier} {order.trackingNumber}</span>}
            </>
          ) : (
            R.noOrder
          )}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {can.approveCancel && (
            <form action={approveCancelAction}><input type="hidden" name="id" value={a.id} /><button className="btn-primary px-3 py-1.5 text-sm">{R.approveCancel}</button></form>
          )}
          {can.acceptReturn && (
            <form action={acceptReturnAction}><input type="hidden" name="id" value={a.id} /><button className="btn-primary px-3 py-1.5 text-sm">{R.acceptReturn}</button></form>
          )}
          {can.cancelSupplier && (
            <form action={cancelSupplierAction}><input type="hidden" name="id" value={a.id} /><button className="btn-secondary px-3 py-1.5 text-sm">{R.cancelSupplier}</button></form>
          )}
          <a href={ebayUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost px-3 py-1.5 text-sm">{R.openOnEbay}<Icon name="external" className="h-3.5 w-3.5" /></a>
        </div>
      </article>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={R.title}
        subtitle={R.subtitle}
        actions={<form action={syncReturnsAction}><button className="btn-secondary px-4 py-2 text-sm"><Icon name="refresh" className="h-4 w-4" />{t.orders.sync}</button></form>}
      />
      {error === "manual" && <Notice>{R.supplierManual}</Notice>}
      {error === "refused" && <Notice tone="red">{R.actionError}</Notice>}
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface/50 p-12 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-emerald-500/12 text-emerald-300"><Icon name="check" /></span>
          <p className="mx-auto mt-4 max-w-md text-sm text-muted">{R.empty}</p>
        </div>
      ) : (
        <>
          <div className="space-y-3">{open.map(card)}</div>
          {closed.length > 0 && (
            <section className="space-y-3">
              <h2 className="eyebrow pt-2">{R.closedTitle}</h2>
              {closed.map(card)}
            </section>
          )}
        </>
      )}
    </div>
  );
}
