/**
 * Publicité automatique (Promoted Listings, coût par vente) : chaque annonce en ligne reçoit le taux le plus élevé
 * qui garde la marge minimum du vendeur, sans dépasser son plafond. Taux ajusté quand le coût ou le prix change,
 * publicité retirée si elle n'est plus rentable ou si le vendeur la désactive.
 */
import type { User } from "@prisma/client";
import { db } from "@/lib/db";
import * as ebay from "@/lib/ebay";
import { userToken } from "@/lib/ebay-account";
import { marketplace, type MarketplaceId } from "@/lib/marketplaces";
import { BRAND } from "@/lib/brand";
import { adRateChanged, affordableAdRate } from "@/lib/pricing";

type Account = { id: string; accessToken: string; accessTokenExpires: Date; refreshToken: string; refreshTokenExpires: Date; scopes?: string | null };
type UserWithAccounts = User & { ebayAccounts: Account[] };

const PER_RUN = 100;

export interface AdsReport { created: number; updated: number; removed: number; skipped: number; errors: number }

/** Met les publicités du vendeur en accord avec ses réglages et ses marges. */
export async function syncAds(user: UserWithAccounts, only?: string[]): Promise<AdsReport> {
  const report: AdsReport = { created: 0, updated: 0, removed: 0, skipped: 0, errors: 0 };
  const listings = await db.listing.findMany({
    where: {
      userId: user.id,
      ebayListingId: { not: null },
      ...(only ? { id: { in: only } } : user.adsEnabled ? { status: { in: ["ACTIVE", "PAUSED"] } } : { adId: { not: null } }),
    },
    take: PER_RUN,
  });
  if (!listings.length) return report;

  const tokens = new Map<string, Promise<string>>();
  const campaigns = new Map<string, Promise<string>>();
  const campaignFor = async (account: Account, marketId: MarketplaceId, token: string) => {
    const key = `${account.id}:${marketId}`;
    if (!campaigns.has(key)) {
      campaigns.set(
        key,
        (async () => {
          const setup = await db.ebayMarketSetup.findUnique({ where: { ebayAccountId_marketplaceId: { ebayAccountId: account.id, marketplaceId: marketId } } });
          if (setup?.adCampaignId) return setup.adCampaignId;
          const id = await ebay.ensureCampaign(token, marketId, `${BRAND.name} ${marketplace(marketId).country}`);
          if (setup) await db.ebayMarketSetup.update({ where: { id: setup.id }, data: { adCampaignId: id } });
          return id;
        })(),
      );
    }
    return campaigns.get(key)!;
  };

  for (const l of listings) {
    const account = user.ebayAccounts.find((a) => a.id === l.ebayAccountId);
    if (!account || !ebay.canAdvertise(account.scopes)) {
      report.skipped++;
      continue;
    }
    const m = marketplace(l.marketplace);
    const target = user.adsEnabled && l.status === "ACTIVE"
      ? affordableAdRate({ price: l.price, cost: l.supplierCost, minMarginPct: user.minMarginPct, marketId: m.id, cap: user.adRateMax })
      : null;
    if (!adRateChanged(l.adRate, target) && (target === null) === (l.adId === null)) continue;
    try {
      if (!tokens.has(account.id)) tokens.set(account.id, userToken(account));
      const token = await tokens.get(account.id)!;
      const campaignId = await campaignFor(account, m.id, token);
      if (target !== null && !l.adId) {
        const [r] = await ebay.createAds(token, campaignId, [{ listingId: l.ebayListingId!, rate: target }], m.id);
        if (!r.ok || !r.adId) throw new Error(r.message ?? "Publicité refusée");
        await db.listing.update({ where: { id: l.id }, data: { adId: r.adId, adRate: target } });
        report.created++;
      } else if (target !== null && l.adId) {
        await ebay.updateAdRate(token, campaignId, l.adId, target, m.id);
        await db.listing.update({ where: { id: l.id }, data: { adRate: target } });
        report.updated++;
      } else if (target === null && l.adId) {
        await ebay.deleteAd(token, campaignId, l.adId, m.id).catch((e) => {
          // Publicité déjà supprimée chez eBay : rien à faire.
          if (!(e instanceof ebay.EbayApiError && e.status === 404)) throw e;
        });
        await db.listing.update({ where: { id: l.id }, data: { adId: null, adRate: null } });
        report.removed++;
      }
    } catch (e) {
      report.errors++;
      console.error("Publicité", l.sku, e);
    }
  }
  return report;
}
