import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { fmt } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { marketplace } from "@/lib/marketplaces";
import { poolWinners } from "@/lib/product-pool";
import { HIGH_TICKET_PROFIT, type CandidateDetails } from "@/lib/sniper";
import WinnersGrid from "@/components/WinnersGrid";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Produits chers (au moins 100 de profit par vente) déjà analysés, et lancement d'une recherche Sniper « High ticket ». */
export default async function HighTicketPage() {
  const user = await requireUser();
  const { t } = await getI18n();
  const H = t.highTicket;
  const market = marketplace(user.defaultMarketplace).id;
  const items = await poolWinners(user.id, market, user.minMarginPct, 24, HIGH_TICKET_PROFIT);
  const hasGpsr = Boolean(user.euRpCompany && user.euRpAddress && user.euRpCity && user.euRpPostalCode && user.euRpCountry && user.euRpEmail);

  return (
    <div className="space-y-6">
      <PageHeader
        title={H.title}
        subtitle={H.subtitle}
        actions={
          <Link href="/sniper?ht=1" className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm">
            <Icon name="zap" className="h-4 w-4" />{H.cta}
          </Link>
        }
      />
      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line-strong bg-surface/50 p-10 text-center text-sm text-muted">{H.empty}</p>
      ) : (
        <WinnersGrid
          items={items.map((r) => ({
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
      <section className="card">
        <h2 className="text-sm font-semibold text-fg">{H.tipsTitle}</h2>
        <ul className="mt-3 space-y-2 text-sm text-muted">
          {[H.tip1, H.tip2, H.tip3].map((tip) => (
            <li key={tip} className="flex gap-2"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />{tip}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
