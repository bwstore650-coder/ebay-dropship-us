import { requireUser } from "@/lib/auth";
import { dailyListingLimit } from "@/lib/compliance";
import { maxEbayAccounts } from "@/lib/plans";
import { fmt } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import CjConnectForm from "@/components/CjConnectForm";
import { EU_COUNTRIES } from "@/lib/eu";
import { aeConfig } from "@/lib/suppliers";
import { LOCALE_TAGS } from "@/lib/i18n";
import { saveGpsr, saveGrowth, saveMessages, saveNotifications, setAutoOrder } from "./actions";
import PushToggle from "@/components/PushToggle";
import { vapidPublicKey } from "@/lib/notify";
import { canAdvertise } from "@/lib/ebay";
import { Icon, type IconName } from "@/components/icons";
import { Notice, Switch } from "@/components/ui";
import ExtensionTokens from "@/components/ExtensionTokens";

export default async function Settings({ searchParams }: { searchParams: Promise<{ ebay?: string; gpsr?: string; ae?: string; saved?: string }> }) {
  const user = await requireUser();
  const { locale, t } = await getI18n();
  const s = t.settings;
  const { ebay, gpsr, ae, saved } = await searchParams;
  const adsReady = user.ebayAccounts.length > 0 && user.ebayAccounts.every((a: { scopes?: string | null }) => canAdvertise(a.scopes));
  const aeAccount = user.supplierAccounts.find((a: { supplier: string }) => a.supplier === "ALIEXPRESS");
  const aeAvailable = Boolean(aeConfig());
  const countryName = new Intl.DisplayNames([LOCALE_TAGS[locale]], { type: "region" });
  const input = "mt-1 w-full input py-2 text-sm";
  const cj = user.supplierAccounts.find((a: { supplier: string }) => a.supplier === "CJ");
  const max = maxEbayAccounts(user.plan);
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight text-fg sm:text-[28px]">{s.title}</h1>
      {ebay === "connected" && <Notice tone="emerald">{s.ebayConnected}</Notice>}
      {ebay === "error" && <Notice tone="red">{s.ebayError}</Notice>}
      {ebay === "limit" && <Notice>{s.ebayLimit}</Notice>}

      <section className="card">
        <h2 className="flex items-center gap-2.5 font-semibold text-fg"><SectionIcon name="globe" />{fmt(s.ebayAccounts, { count: user.ebayAccounts.length, max })}</h2>
        <p className="mt-2 text-sm text-muted">{fmt(s.ebayHelp, { limit: dailyListingLimit(user.ebayAccountOpenedAt) })}</p>
        <ul className="mt-3 space-y-2">
          {user.ebayAccounts.map((a: { id: string; label: string | null; ebayUserId: string | null }, i: number) => (
            <li key={a.id} className="flex items-center justify-between rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-sm">
              <span className="flex items-center gap-2 font-medium text-fg"><span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden="true" />{a.label ?? a.ebayUserId ?? fmt(s.ebayAccountN, { n: i + 1 })}</span>
              <a href={`/api/ebay/connect?account=${a.id}`} className="font-medium text-brand-300 hover:text-brand-200">{s.reconnect}</a>
            </li>
          ))}
        </ul>
        {user.ebayAccounts.length < max && (
          <a href="/api/ebay/connect" className="btn-primary mt-4 px-4 py-2 text-sm">
            {user.ebayAccounts.length ? s.addEbay : s.connectEbay}
          </a>
        )}
      </section>

      <section className="card">
        <h2 className="flex items-center gap-2.5 font-semibold text-fg"><SectionIcon name="box" />{s.cjTitle}</h2>
        <p className="mt-2 text-sm text-muted">{cj ? s.cjConnected : s.cjHelp}</p>
        <CjConnectForm t={s} errors={t.errors} />
      </section>

      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2.5 font-semibold text-fg"><SectionIcon name="cart" />{s.aeTitle}</h2>
          {aeAccount && <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">{s.cjConnected}</span>}
        </div>
        {ae === "connected" && <Notice tone="emerald" className="mt-3">{s.aeConnectedMsg}</Notice>}
        {ae === "error" && <Notice tone="red" className="mt-3">{s.aeError}</Notice>}
        {ae === "unavailable" && <Notice tone="amber" className="mt-3">{s.aeUnavailable}</Notice>}
        <p className="mt-2 text-sm text-muted">{aeAvailable ? s.aeHelp : s.aeUnavailable}</p>
        {aeAvailable && <p className="mt-1 text-xs text-muted">{s.aePayNote}</p>}
        {aeAvailable && (
          <a href="/api/suppliers/aliexpress/connect" className={`mt-3 ${aeAccount ? "btn-secondary" : "btn-primary"} px-4 py-2 text-sm`}>
            {aeAccount ? s.aeReconnect : s.aeConnect}
          </a>
        )}
      </section>

      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2.5 font-semibold text-fg"><SectionIcon name="zap" />{s.autoOrderTitle}</h2>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${user.autoOrder ? "bg-emerald-500/15 text-emerald-300" : "bg-surface-3 text-muted"}`}>
            {user.autoOrder ? s.autoOrderOn : s.autoOrderOff}
          </span>
        </div>
        <p className="mt-2 text-sm text-muted">{s.autoOrderHelp}</p>
        <form action={setAutoOrder} className="mt-3">
          <input type="hidden" name="autoOrder" value={user.autoOrder ? "off" : "on"} />
          <button className={user.autoOrder ? "btn-secondary px-4 py-2 text-sm" : "btn-primary px-4 py-2 text-sm"}>
            {user.autoOrder ? s.autoOrderDisable : s.autoOrderEnable}
          </button>
        </form>
      </section>

      <section id="notifications" className="card scroll-mt-24">
        <h2 className="flex items-center gap-2.5 font-semibold text-fg"><SectionIcon name="alert" />{s.notifyTitle}</h2>
        <p className="mt-2 text-sm text-muted">{s.notifyHelp}</p>
        {saved === "notifications" && <Notice tone="emerald" className="mt-3">{s.saved}</Notice>}
        <form action={saveNotifications} className="mt-4 space-y-3">
          <Switch name="notifySales" defaultChecked={user.notifySales} label={s.notifySales} hint={s.notifySalesHelp} />
          <button className="btn-primary px-4 py-2 text-sm">{s.save}</button>
        </form>
        <div className="mt-4">
          <PushToggle t={s} publicKey={vapidPublicKey()} />
        </div>
      </section>

      <section id="messages" className="card scroll-mt-24">
        <h2 className="flex items-center gap-2.5 font-semibold text-fg"><SectionIcon name="message" />{s.messagesTitle}</h2>
        <p className="mt-2 text-sm text-muted">{s.messagesHelp}</p>
        {saved === "messages" && <Notice tone="emerald" className="mt-3">{s.saved}</Notice>}
        <form action={saveMessages} className="mt-4 space-y-4">
          <Switch name="msgThanks" defaultChecked={user.msgThanks} label={s.msgThanks} hint={s.msgThanksHelp} />
          <Switch name="msgShipped" defaultChecked={user.msgShipped} label={s.msgShipped} hint={s.msgShippedHelp} />
          <Switch name="msgFeedback" defaultChecked={user.msgFeedback} label={s.msgFeedback} hint={s.msgFeedbackHelp} />
          <label className="block max-w-xs text-sm font-medium text-fg-2">
            {s.feedbackDelay}
            <input name="feedbackDelayDays" type="number" min={1} max={30} defaultValue={user.feedbackDelayDays} className={input} />
          </label>
          <p className="text-xs text-subtle">{s.messagesNote}</p>
          <button className="btn-primary px-4 py-2 text-sm">{s.save}</button>
        </form>
      </section>

      <section id="growth" className="card scroll-mt-24">
        <h2 className="flex items-center gap-2.5 font-semibold text-fg"><SectionIcon name="megaphone" />{s.growthTitle}</h2>
        {saved === "growth" && <Notice tone="emerald" className="mt-3">{s.saved}</Notice>}
        <form action={saveGrowth} className="mt-4 space-y-5">
          <div className="space-y-3 rounded-xl border border-line bg-surface-2 p-4">
            <Switch name="adsEnabled" defaultChecked={user.adsEnabled} label={s.adsTitle} hint={s.adsHelp} />
            <label className="block max-w-xs text-sm font-medium text-fg-2">
              {s.adRateMax}
              <input name="adRateMax" type="number" min={2} max={20} step="0.1" defaultValue={user.adRateMax} className={input} />
              <span className="mt-1 block text-xs font-normal text-subtle">{s.adRateHint}</span>
            </label>
            {!adsReady && user.ebayAccounts.length > 0 && <Notice tone="brand">{s.adsReconnect}</Notice>}
          </div>
          <div className="space-y-3 rounded-xl border border-line bg-surface-2 p-4">
            <Switch name="repriceEnabled" defaultChecked={user.repriceEnabled} label={s.repriceTitle} hint={s.repriceHelp} />
            <label className="block max-w-xs text-sm font-medium text-fg-2">
              {s.repriceUndercut}
              <input name="repriceUndercutPct" type="number" min={0} max={10} step="0.1" defaultValue={user.repriceUndercutPct} className={input} />
            </label>
          </div>
          <button className="btn-primary px-4 py-2 text-sm">{s.save}</button>
        </form>
      </section>

      <section id="gpsr" className="scroll-mt-24 card">
        <h2 className="flex items-center gap-2.5 font-semibold text-fg"><SectionIcon name="shield" />{s.gpsrTitle}</h2>
        <p className="mt-2 text-sm text-muted">{s.gpsrHelp}</p>
        {gpsr === "saved" && <Notice tone="emerald" className="mt-3">{s.gpsrSaved}</Notice>}
        {gpsr === "invalid" && <Notice tone="red" className="mt-3">{t.errors.INVALID_INPUT}</Notice>}
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

      <section id="extension" className="card scroll-mt-24">
        <h2 className="flex items-center gap-2.5 font-semibold text-fg"><SectionIcon name="plus" />{t.extension.settingsTitle}</h2>
        <p className="mt-2 text-sm text-muted">{t.extension.settingsText}</p>
        <ExtensionTokens t={t.extension} locale={LOCALE_TAGS[locale]} />
      </section>

      <section className="card">
        <h2 className="flex items-center gap-2.5 font-semibold text-fg"><SectionIcon name="percent" />{s.marginTitle}</h2>
        <p className="mt-2 text-sm text-muted">{fmt(s.marginHelp, { pct: user.minMarginPct })}</p>
      </section>
    </div>
  );
}

function SectionIcon({ name }: { name: IconName }) {
  return (
    <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-500/12 text-brand-300 ring-1 ring-brand-500/20">
      <Icon name={name} className="h-4 w-4" />
    </span>
  );
}
