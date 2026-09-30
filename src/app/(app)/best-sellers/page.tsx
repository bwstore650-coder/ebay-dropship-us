import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";
import { isMarketplaceId, marketplace, MARKETPLACE_IDS, type MarketplaceId } from "@/lib/marketplaces";
import { TREND_NICHES } from "@/lib/research";
import { getTrends } from "@/lib/research-service";
import TrendCard from "@/components/TrendCard";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function BestSellersPage({ searchParams }: { searchParams: Promise<{ n?: string; m?: string }> }) {
  const user = await requireUser();
  const { t } = await getI18n();
  const R = t.research;
  const { n, m } = await searchParams;
  const market = marketplace(m && isMarketplaceId(m) ? (m as MarketplaceId) : user.defaultMarketplace).id;
  const niche = n && (TREND_NICHES as readonly string[]).includes(n) ? n : undefined;
  const items = await getTrends(market, { niche, limit: 60 });
  const href = (p: { n?: string; m?: string }) => `/best-sellers?${new URLSearchParams({ m: p.m ?? market, ...(p.n ? { n: p.n } : {}) })}`;
  const chip = (active: boolean) => `whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${active ? "bg-brand-500/15 text-fg ring-1 ring-brand-500/40" : "text-muted hover:bg-surface-2 hover:text-fg"}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={R.trendsTitle}
        subtitle={R.trendsSubtitle}
        actions={
          <div className="flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1">
            {MARKETPLACE_IDS.map((id) => (
              <Link key={id} href={href({ m: id, n: niche })} className={chip(id === market)} title={t.markets[id]}>{marketplace(id).country}</Link>
            ))}
          </div>
        }
      />
      <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        <Link href={href({ m: market })} className={chip(!niche)}>{R.allNiches}</Link>
        {TREND_NICHES.map((k) => (
          <Link key={k} href={href({ m: market, n: k })} className={chip(niche === k)}>{(R.niches as Record<string, string>)[k]}</Link>
        ))}
      </nav>
      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line-strong bg-surface/50 p-10 text-center text-sm text-muted">{R.noTrends}</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
          {items.map((it) => <TrendCard key={it.itemId} item={it} t={R} marketId={market} />)}
        </div>
      )}
    </div>
  );
}
