import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmt, LOCALE_TAGS } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { ebayItemUrl } from "@/lib/listing";
import { marketplace } from "@/lib/marketplaces";
import { checkNowAction, deleteDraftAction, endListingAction } from "./actions";
import { Icon } from "@/components/icons";
import { PageHeader, StatusBadge } from "@/components/ui";
import { LISTING_TONE } from "@/lib/status-tones";

export const dynamic = "force-dynamic";


export default async function ListingsPage() {
  const user = await requireUser();
  const { locale, t } = await getI18n();
  const L = t.listings;
  const listings = await db.listing.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 200 });
  const status = { DRAFT: L.statusDRAFT, ACTIVE: L.statusACTIVE, PAUSED: L.statusPAUSED, ENDED: L.statusENDED };

  return (
    <div className="space-y-6">
      <PageHeader
        title={L.title}
        subtitle={L.monitorNote}
        actions={
          <>
            {listings.length > 0 && (
              <form action={checkNowAction}>
                <button className="btn-secondary px-4 py-2 text-sm"><Icon name="refresh" className="h-4 w-4" />{L.checkNow}</button>
              </form>
            )}
            <Link href="/finder" className="btn-primary px-4 py-2 text-sm"><Icon name="search" className="h-4 w-4" />{L.findProduct}</Link>
          </>
        }
      />
      {listings.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface/50 p-12 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-brand-500/12 text-brand-300"><Icon name="tag" /></span>
          <p className="mx-auto mt-4 max-w-md text-sm text-muted">{L.empty}</p>
          <Link href="/finder" className="btn-primary mt-5 px-4 py-2 text-sm">{L.findProduct}</Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-line text-xs tracking-wide text-subtle uppercase">
              <tr>
                <th className="px-4 py-3 font-medium">{L.colTitle}</th>
                <th className="px-4 py-3 font-medium">{L.colMarket}</th>
                <th className="px-4 py-3 font-medium">{L.colPrice}</th>
                <th className="px-4 py-3 font-medium">{L.colMargin}</th>
                <th className="px-4 py-3 font-medium">{L.colStatus}</th>
                <th className="px-4 py-3 font-medium">{L.colDate}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {listings.map((l) => {
                const m = marketplace(l.marketplace);
                return (
                  <tr key={l.id} className="align-top transition hover:bg-surface-2/60">
                    <td className="max-w-sm px-4 py-3">
                      <p className="font-medium text-fg">{l.title}</p>
                      {l.status === "PAUSED" && l.pauseReason && (
                        <p className="mt-1 text-xs text-amber-300">
                          {fmt((L.pause as Record<string, string>)[l.pauseReason] ?? L.pause.OUT_OF_STOCK, { detail: l.pauseDetail ? `${l.pauseDetail} ${m.symbol}` : "" })}
                        </p>
                      )}
                      {(l.adRate !== null || l.repricedAt) && (
                        <p className="mt-1.5 flex flex-wrap gap-1.5">
                          {l.adRate !== null && <span className="badge bg-fuchsia-500/15 text-fuchsia-300"><Icon name="megaphone" className="h-3 w-3" />{fmt(L.adBadge, { rate: l.adRate })}</span>}
                          {l.repricedAt && l.basePrice !== null && l.price !== l.basePrice && (
                            <span className="badge bg-sky-500/15 text-sky-300">{fmt(L.repriced, { date: l.repricedAt.toLocaleDateString(LOCALE_TAGS[locale]) })}</span>
                          )}
                        </p>
                      )}
                      {l.errorMessage && (
                        <p className="mt-1 text-xs text-red-400">{fmt(L.lastError, { message: l.errorMessage })}</p>
                      )}
                      {l.lastCheckedAt && l.status !== "DRAFT" && l.status !== "ENDED" && (
                        <p className="mt-1 text-xs text-subtle">{fmt(L.checkedAt, { date: l.lastCheckedAt.toLocaleString(LOCALE_TAGS[locale], { dateStyle: "short", timeStyle: "short" }) })}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-fg-2">{t.markets[m.id]}</td>
                    <td className="px-4 py-3 font-medium whitespace-nowrap text-fg tabular-nums">{l.price.toFixed(2)} {m.symbol}</td>
                    <td className={`px-4 py-3 font-medium tabular-nums ${l.lastMarginPct === null ? "text-subtle" : l.lastMarginPct >= 30 ? "text-emerald-300" : "text-amber-300"}`}>{l.lastMarginPct !== null ? `${l.lastMarginPct} %` : "—"}</td>
                    <td className="px-4 py-3">
                      <StatusBadge tone={LISTING_TONE[l.status]}>{status[l.status]}</StatusBadge>
                    </td>
                    <td className="px-4 py-3 text-muted">{(l.publishedAt ?? l.createdAt).toLocaleDateString(LOCALE_TAGS[locale])}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-3 whitespace-nowrap">
                        {l.ebayListingId && l.status === "ACTIVE" && (
                          <a href={ebayItemUrl(m.id, l.ebayListingId)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-300 hover:text-brand-200">{L.view}<Icon name="external" className="h-3.5 w-3.5" /></a>
                        )}
                        {l.status === "DRAFT" && !l.ebayListingId && (
                          <form action={deleteDraftAction}>
                            <input type="hidden" name="listingId" value={l.id} />
                            <button className="font-medium text-muted hover:text-red-300">{L.removeDraft}</button>
                          </form>
                        )}
                        {(l.status === "ACTIVE" || l.status === "PAUSED") && (
                          <form action={endListingAction}>
                            <input type="hidden" name="listingId" value={l.id} />
                            <button className="font-medium text-muted hover:text-red-300">{L.end}</button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
