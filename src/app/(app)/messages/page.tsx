import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { LOCALE_TAGS } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { aiConfigured } from "@/lib/ai";
import MessagesClient from "@/components/MessagesClient";

export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  const user = await requireUser();
  const { locale, t } = await getI18n();
  const msgs = await db.buyerMessage.findMany({ where: { userId: user.id, status: "NEW" }, orderBy: { receivedAt: "desc" }, take: 50 });
  const orderIds = msgs.map((m) => m.orderId).filter((x): x is string => Boolean(x));
  const orders = orderIds.length
    ? await db.order.findMany({ where: { id: { in: orderIds }, userId: user.id }, select: { id: true, status: true, trackingNumber: true, carrier: true } })
    : [];
  const byId = new Map(orders.map((o) => [o.id, o]));
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-fg">{t.messages.title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">{t.messages.subtitle}</p>
      </div>
      <MessagesClient
        t={t.messages}
        errors={t.errors}
        statusLabels={t.orders.status as Record<string, string>}
        localeTag={LOCALE_TAGS[locale]}
        aiOn={aiConfigured() && user.plan !== "NONE"}
        initial={msgs.map((m) => {
          const o = m.orderId ? byId.get(m.orderId) : undefined;
          return {
            id: m.id, buyer: m.buyer, itemTitle: m.itemTitle, subject: m.subject, body: m.body, receivedAt: m.receivedAt.toISOString(),
            draft: m.draft, draftError: m.draftError, order: o ? { status: o.status, trackingNumber: o.trackingNumber, carrier: o.carrier } : null,
          };
        })}
      />
    </div>
  );
}
