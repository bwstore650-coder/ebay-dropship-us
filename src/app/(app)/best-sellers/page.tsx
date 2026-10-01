import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";
import { isMarketplaceId, marketplace, MARKETPLACE_IDS, type MarketplaceId } from "@/lib/marketplaces";
import { poolStats, poolWinners } from "@/lib/product-pool";
import { fmt } from "@/lib/i18n";
import type { CandidateDetails } from "@/lib/sniper";
import WinnersGrid from "@/components/WinnersGrid";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function BestSellersPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const user = await requireUser();
  const { t } = await getI18n();
  const R = t.research;
  const { m } = await searchParams;
  const market = marketplace(m && isMarketplaceId(m) ? (m as MarketplaceId) : user.defaultMarketplace).id;
  const [winners, stats] = await Promise.all([
    poolWinners(user.id, market, user.minMarginPct, 24),
    poolStats(market),
  ]);
  const hasGpsr = Boolean(user.euRpCompany && user.euRpAddress && user.euRpCity && user.euRpPostalCode && user.euRpCountry && user.euRpEmail);
  const W = t.winners;
  const href = (p: { m: string }) => `/best-sellers?${new URLSearchParams({ m: p.m })}`;
  const chip = (active: boolean) => `whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${active ? "bg-brand-500/15 text-fg ring-1 ring-brand-500/40" : "text-muted hover:bg-surface-2 hover:text-fg"}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={R.trendsTitle}
        subtitle={R.trendsSubtitle}
        actions={
          <div className="flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1">
            {MARKETPLACE_IDS.map((id) => (
              <Link key={id} href={href({ m: id })} className={chip(id === market)} title={t.markets[id]}>{marketplace(id).country}</Link>
            ))}
          </div>
        }
      />
      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-fg">{W.title}</h2>
            <p className="text-sm text-muted">{fmt(W.subtitle, { total: stats.total, margin: user.minMarginPct })}</p>
          </div>
          <Link href="/sniper" className="text-sm font-medium text-brand-300 hover:text-brand-200">{W.more}</Link>
        </div>
        {winners.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line-strong bg-surface/50 p-8 text-center text-sm text-muted">{W.empty}</p>
        ) : (
          <WinnersGrid
            items={winners.map((r) => ({
              id: r.id, keyword: r.keyword, supplier: r.supplier, productId: r.productId, variantId: r.variantId, title: r.title, image: r.image,
              status: "PROFITABLE" as const, reason: null, marketPrice: r.marketPrice, cost: r.cost, profit: r.profit, marginPct: r.marginPct,
              unitsSold: r.unitsSold, deliveryDaysMax: r.deliveryDaysMax, details: (r.details ?? null) as CandidateDetails | null, listingId: null, expired: false,
            }))}
            t={t.sniper}
            tl={t.listing}
            markets={t.markets}
            errors={t.errors}
            accounts={user.ebayAccounts.map((a, i) => ({ id: a.id, label: a.label ?? a.ebayUserId ?? fmt(t.settings.ebayAccountN, { n: i + 1 }) }))}
            hasGpsr={hasGpsr}
            marketId={market}
            minMargin={user.minMarginPct}
          />
        )}
      </section>

    </div>
  );
}
