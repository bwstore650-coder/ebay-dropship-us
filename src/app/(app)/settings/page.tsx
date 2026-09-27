import { requireUser } from "@/lib/auth";
import { dailyListingLimit } from "@/lib/compliance";
import { maxEbayAccounts } from "@/lib/plans";
import { fmt } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import CjConnectForm from "@/components/CjConnectForm";

export default async function Settings({ searchParams }: { searchParams: Promise<{ ebay?: string }> }) {
  const user = await requireUser();
  const { t } = await getI18n();
  const s = t.settings;
  const { ebay } = await searchParams;
  const cj = user.supplierAccounts.find((a: { supplier: string }) => a.supplier === "CJ");
  const max = maxEbayAccounts(user.plan);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{s.title}</h1>
      {ebay === "connected" && <p className="rounded-lg bg-green-50 p-3 text-green-700">{s.ebayConnected}</p>}
      {ebay === "error" && <p className="rounded-lg bg-red-50 p-3 text-red-700">{s.ebayError}</p>}
      {ebay === "limit" && <p className="rounded-lg bg-amber-50 p-3 text-amber-700">{s.ebayLimit}</p>}

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="font-semibold">{fmt(s.ebayAccounts, { count: user.ebayAccounts.length, max })}</h2>
        <p className="mt-1 text-sm text-slate-600">{fmt(s.ebayHelp, { limit: dailyListingLimit(user.ebayAccountOpenedAt) })}</p>
        <ul className="mt-3 space-y-2">
          {user.ebayAccounts.map((a: { id: string; label: string | null; ebayUserId: string | null }, i: number) => (
            <li key={a.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <span>{a.label ?? a.ebayUserId ?? fmt(s.ebayAccountN, { n: i + 1 })}</span>
              <a href={`/api/ebay/connect?account=${a.id}`} className="text-blue-600">{s.reconnect}</a>
            </li>
          ))}
        </ul>
        {user.ebayAccounts.length < max && (
          <a href="/api/ebay/connect" className="mt-3 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">
            {user.ebayAccounts.length ? s.addEbay : s.connectEbay}
          </a>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="font-semibold">{s.cjTitle}</h2>
        <p className="mt-1 text-sm text-slate-600">{cj ? s.cjConnected : s.cjHelp}</p>
        <CjConnectForm t={s} errors={t.errors} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="font-semibold">{s.aeTitle}</h2>
        <p className="mt-1 text-sm text-slate-600">{s.aeHelp}</p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="font-semibold">{s.marginTitle}</h2>
        <p className="mt-1 text-sm text-slate-600">{fmt(s.marginHelp, { pct: user.minMarginPct })}</p>
      </section>
    </div>
  );
}
