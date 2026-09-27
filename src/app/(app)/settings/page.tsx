import { requireUser } from "@/lib/auth";
import { dailyListingLimit } from "@/lib/compliance";
import { maxEbayAccounts } from "@/lib/plans";
import { fmt } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import CjConnectForm from "@/components/CjConnectForm";
import { EU_COUNTRIES } from "@/lib/eu";
import { LOCALE_TAGS } from "@/lib/i18n";
import { saveGpsr, setAutoOrder } from "./actions";

export default async function Settings({ searchParams }: { searchParams: Promise<{ ebay?: string; gpsr?: string }> }) {
  const user = await requireUser();
  const { locale, t } = await getI18n();
  const s = t.settings;
  const { ebay, gpsr } = await searchParams;
  const countryName = new Intl.DisplayNames([LOCALE_TAGS[locale]], { type: "region" });
  const input = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none";
  const cj = user.supplierAccounts.find((a: { supplier: string }) => a.supplier === "CJ");
  const max = maxEbayAccounts(user.plan);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{s.title}</h1>
      {ebay === "connected" && <p className="rounded-lg bg-green-50 p-3 text-emerald-700">{s.ebayConnected}</p>}
      {ebay === "error" && <p className="rounded-lg bg-red-50 p-3 text-red-700">{s.ebayError}</p>}
      {ebay === "limit" && <p className="rounded-lg bg-amber-50 p-3 text-amber-700">{s.ebayLimit}</p>}

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
        <h2 className="font-semibold">{fmt(s.ebayAccounts, { count: user.ebayAccounts.length, max })}</h2>
        <p className="mt-1 text-sm text-slate-600">{fmt(s.ebayHelp, { limit: dailyListingLimit(user.ebayAccountOpenedAt) })}</p>
        <ul className="mt-3 space-y-2">
          {user.ebayAccounts.map((a: { id: string; label: string | null; ebayUserId: string | null }, i: number) => (
            <li key={a.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <span>{a.label ?? a.ebayUserId ?? fmt(s.ebayAccountN, { n: i + 1 })}</span>
              <a href={`/api/ebay/connect?account=${a.id}`} className="text-brand-600">{s.reconnect}</a>
            </li>
          ))}
        </ul>
        {user.ebayAccounts.length < max && (
          <a href="/api/ebay/connect" className="mt-3 inline-block rounded-lg bg-brand-600 px-4 shadow-sm transition hover:bg-brand-700 py-2 text-sm font-semibold text-white">
            {user.ebayAccounts.length ? s.addEbay : s.connectEbay}
          </a>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
        <h2 className="font-semibold">{s.cjTitle}</h2>
        <p className="mt-1 text-sm text-slate-600">{cj ? s.cjConnected : s.cjHelp}</p>
        <CjConnectForm t={s} errors={t.errors} />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
        <h2 className="font-semibold">{s.aeTitle}</h2>
        <p className="mt-1 text-sm text-slate-600">{s.aeHelp}</p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">{s.autoOrderTitle}</h2>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${user.autoOrder ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}>
            {user.autoOrder ? s.autoOrderOn : s.autoOrderOff}
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-600">{s.autoOrderHelp}</p>
        <form action={setAutoOrder} className="mt-3">
          <input type="hidden" name="autoOrder" value={user.autoOrder ? "off" : "on"} />
          <button className={user.autoOrder ? "btn-secondary px-4 py-2 text-sm" : "btn-primary px-4 py-2 text-sm"}>
            {user.autoOrder ? s.autoOrderDisable : s.autoOrderEnable}
          </button>
        </form>
      </section>

      <section id="gpsr" className="scroll-mt-24 rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
        <h2 className="font-semibold">{s.gpsrTitle}</h2>
        <p className="mt-1 text-sm text-slate-600">{s.gpsrHelp}</p>
        {gpsr === "saved" && <p className="mt-3 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-700">{s.gpsrSaved}</p>}
        {gpsr === "invalid" && <p className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-700">{t.errors.INVALID_INPUT}</p>}
        <form action={saveGpsr} className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">{s.gpsrCompany}<input name="euRpCompany" required maxLength={100} defaultValue={user.euRpCompany ?? ""} className={input} /></label>
          <label className="block text-sm font-medium">{s.gpsrEmail}<input name="euRpEmail" type="email" required maxLength={120} defaultValue={user.euRpEmail ?? ""} className={input} /></label>
          <label className="block text-sm font-medium sm:col-span-2">{s.gpsrAddress}<input name="euRpAddress" required maxLength={150} defaultValue={user.euRpAddress ?? ""} className={input} /></label>
          <label className="block text-sm font-medium">{s.gpsrPostalCode}<input name="euRpPostalCode" required maxLength={12} defaultValue={user.euRpPostalCode ?? ""} className={input} /></label>
          <label className="block text-sm font-medium">{s.gpsrCity}<input name="euRpCity" required maxLength={80} defaultValue={user.euRpCity ?? ""} className={input} /></label>
          <label className="block text-sm font-medium">
            {s.gpsrCountry}
            <select name="euRpCountry" required defaultValue={user.euRpCountry ?? ""} className={input}>
              <option value="" disabled>—</option>
              {[...EU_COUNTRIES].sort((a, b) => (countryName.of(a) ?? a).localeCompare(countryName.of(b) ?? b)).map((c) => (
                <option key={c} value={c}>{countryName.of(c) ?? c}</option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button className="btn-primary px-4 py-2 text-sm">{s.gpsrSave}</button>
          </div>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
        <h2 className="font-semibold">{s.marginTitle}</h2>
        <p className="mt-1 text-sm text-slate-600">{fmt(s.marginHelp, { pct: user.minMarginPct })}</p>
      </section>
    </div>
  );
}
