import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { fmt, LOCALE_TAGS } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { marketplace } from "@/lib/marketplaces";
import { accountHealth, type AccountHealth, type Alert } from "@/lib/account-health";
import { Icon } from "@/components/icons";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LEVEL_TONE: Record<string, string> = {
  TOP_RATED: "bg-emerald-500/15 text-emerald-300",
  ABOVE_STANDARD: "bg-sky-500/15 text-sky-300",
  BELOW_STANDARD: "bg-red-500/15 text-red-300",
};

export default async function HealthPage({ searchParams }: { searchParams: Promise<{ fresh?: string }> }) {
  const { fresh } = await searchParams;
  const user = await requireUser();
  const { locale, t } = await getI18n();
  const H = t.health;
  const tag = LOCALE_TAGS[locale];
  const m = marketplace(user.defaultMarketplace);

  const results = await Promise.all(
    user.ebayAccounts.map(async (a, i) => ({
      label: a.label ?? a.ebayUserId ?? fmt(t.settings.ebayAccountN, { n: i + 1 }),
      health: await accountHealth(user.id, a, m.id, fresh === "1").catch((e) => {
        console.error("Santé du compte", a.id, e);
        return null;
      }),
    })),
  );

  const alertText = (a: Alert) => {
    switch (a.kind) {
      case "BELOW_STANDARD": return H.aBELOW_STANDARD;
      case "NOT_ORDERED": return fmt(H.aNOT_ORDERED, { n: a.n });
      case "NO_TRACKING": return fmt(H.aNO_TRACKING, { n: a.n });
      case "LIMIT": return fmt(H.aLIMIT, { p: Math.round(a.share * 100) });
      case "RECONNECT": return H.aRECONNECT;
    }
  };
  const levelLabel = (l: string) => ({ TOP_RATED: H.level_TOP_RATED, ABOVE_STANDARD: H.level_ABOVE_STANDARD, BELOW_STANDARD: H.level_BELOW_STANDARD } as Record<string, string>)[l] ?? H.level_UNKNOWN;
  const num = (v: number, max = 0) => new Intl.NumberFormat(tag, { maximumFractionDigits: max }).format(v);
  const time = (iso: string) => new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

  const bar = (share: number) => (
    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-3">
      <div className={`h-full rounded-full ${share >= 0.8 ? "bg-red-400" : share >= 0.6 ? "bg-amber-400" : "bg-emerald-400"}`} style={{ width: `${Math.min(100, share * 100)}%` }} />
    </div>
  );

  const account = (label: string, h: AccountHealth) => (
    <section key={h.accountId} className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-fg">{label} · {t.markets[h.marketId]}</h2>
        <p className="text-xs text-subtle">{fmt(H.checked, { time: time(h.checkedAt) })} · <Link href="/health?fresh=1" className="text-brand-300 hover:text-brand-200">{H.refresh}</Link></p>
      </div>

      {h.alerts.length === 0 ? (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
          <Icon name="shield" className="h-5 w-5 shrink-0" />{H.allGood}
        </div>
      ) : (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-200"><Icon name="alert" className="h-4 w-4" />{fmt(H.alertsTitle, { n: h.alerts.length })}</p>
          <ul className="mt-2 space-y-1 text-sm text-fg-2">
            {h.alerts.map((a) => <li key={a.kind}>• {alertText(a)}</li>)}
          </ul>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card">
          <h3 className="font-semibold text-fg">{H.standards}</h3>
          {h.needsReconnect ? (
            <div className="mt-3 space-y-2 text-sm text-muted">
              <p>{H.aRECONNECT}</p>
              <a href={`/api/ebay/connect?account=${h.accountId}`} className="btn-secondary inline-flex px-3 py-1.5 text-sm">{H.reconnect}</a>
            </div>
          ) : h.standards ? (
            <div className="mt-3 space-y-3">
              <span className={`badge ${LEVEL_TONE[h.standards.level] ?? "bg-surface-3 text-muted"}`}>{levelLabel(h.standards.level)}</span>
              {h.standards.evaluatedAt && <p className="text-xs text-subtle">{fmt(H.evaluated, { date: time(h.standards.evaluatedAt) })}</p>}
              <dl className="space-y-1.5 text-sm">
                {h.standards.metrics.filter((x) => x.value !== null).slice(0, 6).map((x) => (
                  <div key={x.key} className="flex justify-between gap-3">
                    <dt className="text-muted">{x.name}</dt>
                    <dd className={`tabular-nums ${x.level === "BELOW_STANDARD" ? "text-red-300" : "text-fg-2"}`}>{num(x.value!, 2)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">{h.standardsError ? H.standardsError : H.level_UNKNOWN}</p>
          )}
        </div>

        <div className="card">
          <h3 className="font-semibold text-fg">{H.limits}</h3>
          {h.usage?.quantity || h.usage?.amount ? (
            <div className="mt-3 space-y-4 text-sm">
              {h.usage.quantity && (
                <div>
                  <div className="flex justify-between gap-3"><span className="text-muted">{H.limitItems}</span><span className="tabular-nums text-fg-2">{num(h.usage.quantity.used)} / {num(h.usage.quantity.limit)}</span></div>
                  {bar(h.usage.quantity.share)}
                </div>
              )}
              {h.usage.amount && (
                <div>
                  <div className="flex justify-between gap-3"><span className="text-muted">{H.limitAmount}</span><span className="tabular-nums text-fg-2">{num(h.usage.amount.used)} / {num(h.usage.amount.limit)} {h.usage.amount.currency ?? ""}</span></div>
                  {bar(h.usage.amount.share)}
                </div>
              )}
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">{H.noLimit}</p>
          )}
        </div>

        <div className="card">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-semibold text-fg">{H.risky}</h3>
            {h.risks.length > 0 && <Link href="/orders" className="text-sm font-medium text-brand-300 hover:text-brand-200">{H.seeOrders}</Link>}
          </div>
          {h.risks.length ? (
            <ul className="mt-3 space-y-1.5 text-sm">
              {h.risks.slice(0, 8).map((r) => (
                <li key={r.id} className="flex justify-between gap-3">
                  <span className="truncate text-fg-2">{r.ebayOrderId}</span>
                  <span className={`shrink-0 tabular-nums ${r.reason === "NOT_ORDERED" ? "text-red-300" : "text-amber-300"}`}>{fmt(r.reason === "NOT_ORDERED" ? H.riskNOT_ORDERED : H.riskNO_TRACKING, { h: r.hours })}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted">{H.noRisk}</p>
          )}
        </div>
      </div>
    </section>
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-fg">{H.title}</h1>
        <p className="mt-1 text-sm text-muted">{H.subtitle}</p>
      </div>

      {results.length === 0 ? (
        <div className="card text-sm text-muted">
          <p>{H.noAccount}</p>
          <Link href="/settings" className="btn-primary mt-3 inline-flex px-4 py-2 text-sm">{H.connect}</Link>
        </div>
      ) : (
        results.map((r) => (r.health ? account(r.label, r.health) : <p key={r.label} className="card text-sm text-muted">{H.standardsError}</p>))
      )}

      <section className="card">
        <h2 className="font-semibold text-fg">{H.built}</h2>
        <ul className="mt-3 grid gap-2 text-sm text-fg-2 sm:grid-cols-2">
          {[H.b1, H.b2, H.b3, H.b4].map((b) => (
            <li key={b} className="flex items-start gap-2"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" strokeWidth={3} />{b}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
