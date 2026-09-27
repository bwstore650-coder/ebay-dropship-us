import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmt, LOCALE_TAGS } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { ebayItemUrl } from "@/lib/listing";
import { marketplace } from "@/lib/marketplaces";
import { endListingAction } from "./actions";

export const dynamic = "force-dynamic";

const BADGE = {
  DRAFT: "bg-slate-100 text-slate-600",
  ACTIVE: "bg-emerald-100 text-emerald-800",
  PAUSED: "bg-amber-100 text-amber-800",
  ENDED: "bg-slate-200 text-slate-600",
} as const;

export default async function ListingsPage() {
  const user = await requireUser();
  const { locale, t } = await getI18n();
  const L = t.listings;
  const listings = await db.listing.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 200 });
  const status = { DRAFT: L.statusDRAFT, ACTIVE: L.statusACTIVE, PAUSED: L.statusPAUSED, ENDED: L.statusENDED };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{L.title}</h1>
        <Link href="/finder" className="btn-primary px-4 py-2 text-sm">{L.findProduct}</Link>
      </div>
      {listings.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">{L.empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
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
            <tbody className="divide-y divide-slate-100">
              {listings.map((l) => {
                const m = marketplace(l.marketplace);
                return (
                  <tr key={l.id} className="align-top">
                    <td className="max-w-sm px-4 py-3">
                      <p className="font-medium text-slate-900">{l.title}</p>
                      {l.errorMessage && l.status !== "ACTIVE" && (
                        <p className="mt-1 text-xs text-red-600">{fmt(L.lastError, { message: l.errorMessage })}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">{t.markets[m.id]}</td>
                    <td className="px-4 py-3 tabular-nums">{l.price.toFixed(2)} {m.symbol}</td>
                    <td className="px-4 py-3 tabular-nums">{l.lastMarginPct !== null ? `${l.lastMarginPct} %` : "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${BADGE[l.status]}`}>{status[l.status]}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{(l.publishedAt ?? l.createdAt).toLocaleDateString(LOCALE_TAGS[locale])}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-3 whitespace-nowrap">
                        {l.ebayListingId && l.status === "ACTIVE" && (
                          <a href={ebayItemUrl(m.id, l.ebayListingId)} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-600 hover:underline">{L.view}</a>
                        )}
                        {l.status === "ACTIVE" && (
                          <form action={endListingAction}>
                            <input type="hidden" name="listingId" value={l.id} />
                            <button className="font-medium text-slate-500 hover:text-red-600">{L.end}</button>
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
