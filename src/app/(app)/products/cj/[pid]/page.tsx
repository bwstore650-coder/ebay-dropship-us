import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { analyzeForExtension, cleanProductId, ExtensionError } from "@/lib/extension";
import { isQuotaError } from "@/lib/ebay";
import { fmt } from "@/lib/i18n";
import { errorMessage } from "@/lib/i18n/errors";
import { getI18n } from "@/lib/i18n/server";
import { isMarketplaceId, marketplace, type MarketplaceId } from "@/lib/marketplaces";
import type { CandidateDetails } from "@/lib/sniper";
import WinnersGrid from "@/components/WinnersGrid";
import { Notice, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Produit CJ ouvert depuis l'extension (« Créer l'annonce ») : analyse + éditeur d'annonce. */
export default async function CjProductPage({ params, searchParams }: { params: Promise<{ pid: string }>; searchParams: Promise<{ m?: string }> }) {
  const user = await requireUser();
  const { t } = await getI18n();
  const E = t.extension;
  const { pid } = await params;
  const { m } = await searchParams;
  const productId = cleanProductId(decodeURIComponent(pid));
  const market = marketplace(m && isMarketplaceId(m) ? (m as MarketplaceId) : user.defaultMarketplace).id;

  let error: string | null = productId ? null : "INVALID_INPUT";
  if (productId) {
    try {
      await analyzeForExtension(user, productId, market);
    } catch (e) {
      error = e instanceof ExtensionError ? e.code : isQuotaError(e) ? "EBAY_QUOTA" : "UPSTREAM";
      if (!(e instanceof ExtensionError)) console.error("Produit CJ", productId, e);
    }
  }
  const r = productId
    ? await db.productInsight.findUnique({ where: { marketplace_supplier_productId: { marketplace: market, supplier: "CJ", productId } } })
    : null;
  const hasGpsr = Boolean(user.euRpCompany && user.euRpAddress && user.euRpCity && user.euRpPostalCode && user.euRpCountry && user.euRpEmail);

  return (
    <div className="space-y-6">
      <PageHeader title={E.productTitle} subtitle={E.productSubtitle} />
      {error && <Notice tone="red">{errorMessage(t.errors, error)}</Notice>}
      {r ? (
        <WinnersGrid
          items={[{
            id: r.id, keyword: r.keyword, supplier: r.supplier, productId: r.productId, variantId: r.variantId, title: r.title, image: r.image,
            status: r.reason ? ("REJECTED" as const) : ("PROFITABLE" as const), reason: r.reason, marketPrice: r.marketPrice, cost: r.cost,
            profit: r.profit, marginPct: r.marginPct, unitsSold: r.unitsSold, deliveryDaysMax: r.deliveryDaysMax,
            details: (r.details ?? null) as CandidateDetails | null, listingId: null, expired: false,
          }]}
          t={t.sniper}
          tl={t.listing}
          markets={t.markets}
          errors={t.errors}
          accounts={user.ebayAccounts.map((a, i) => ({ id: a.id, label: a.label ?? a.ebayUserId ?? fmt(t.settings.ebayAccountN, { n: i + 1 }) }))}
          hasGpsr={hasGpsr}
          marketId={market}
          minMargin={user.minMarginPct}
        />
      ) : (
        !error && <p className="rounded-2xl border border-dashed border-line-strong bg-surface/50 p-10 text-center text-sm text-muted">{E.notAnalyzed}</p>
      )}
    </div>
  );
}
