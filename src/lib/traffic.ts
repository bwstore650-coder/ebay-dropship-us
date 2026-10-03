/**
 * Performance des annonces (comme Seller Hub › Performance › Trafic) : impressions, vues, ventes, taux de clic,
 * taux de conversion, d'où viennent les impressions et les vues, et le détail par annonce.
 * Données eBay du vendeur (API Analytics), gardées 6 h en cache.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import * as ebay from "@/lib/ebay";
import { userToken } from "@/lib/ebay-account";
import { readState, writeState } from "@/lib/ebay-quota";
import type { MarketplaceId } from "@/lib/marketplaces";

const DAY = 86_400_000;
const CACHE_MS = 6 * 3600_000;
export const TRAFFIC_PERIODS = [7, 30, 90] as const;

export interface TrafficTotals {
  impressions: number;
  views: number;
  sold: number;
  ctr: number | null;        // vues / impressions, en %
  conversion: number | null; // ventes / vues, en %
  impressionsBySource: { search: number; store: number; other: number };
  viewsBySource: { search: number; store: number; direct: number; offEbay: number; otherEbay: number };
}
export interface TrafficDay { day: string; impressions: number; views: number; sold: number }
export interface TrafficListing { itemId: string; title: string | null; impressions: number; views: number; sold: number; ctr: number | null }
export interface TrafficOverview { days: number; current: TrafficTotals; previous: TrafficTotals; series: TrafficDay[]; listings: TrafficListing[]; checkedAt: string }

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const n = (v: number | undefined) => (Number.isFinite(v) ? (v as number) : 0);

/** Totaux d'une liste de lignes (jours ou annonces). */
export function sumTraffic(rows: ebay.TrafficRow[]): TrafficTotals {
  const s = (k: ebay.TrafficMetric) => rows.reduce((t, r) => t + n(r[k]), 0);
  const impressions = s("TOTAL_IMPRESSION_TOTAL");
  const search = s("LISTING_IMPRESSION_SEARCH_RESULTS_PAGE");
  const store = s("LISTING_IMPRESSION_STORE");
  const views = s("LISTING_VIEWS_TOTAL");
  const sold = s("TRANSACTION");
  return {
    impressions, views, sold,
    ctr: pct(views, impressions),
    conversion: pct(sold, views),
    impressionsBySource: { search, store, other: Math.max(0, impressions - search - store) },
    viewsBySource: {
      search: s("LISTING_VIEWS_SOURCE_SEARCH_RESULTS_PAGE"), store: s("LISTING_VIEWS_SOURCE_STORE"), direct: s("LISTING_VIEWS_SOURCE_DIRECT"),
      offEbay: s("LISTING_VIEWS_SOURCE_OFF_EBAY"), otherEbay: s("LISTING_VIEWS_SOURCE_OTHER_EBAY"),
    },
  };
}

/**
 * Jour en cours pour eBay (heure du Pacifique), à minuit UTC : eBay refuse une date de fin « dans le futur »,
 * et le soir en Europe / la nuit en UTC, la date UTC a déjà un jour d'avance sur celle d'eBay.
 */
export function ebayToday(now = Date.now()): number {
  const d = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
  return Date.parse(`${d}T00:00:00Z`);
}

/** « 20261002 » ou « 2026-10-02 » → « 2026-10-02 ». */
export const dayKey = (v: string) => (/^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : v.slice(0, 10));

/** Sépare les jours en période actuelle / précédente et remplit les jours sans données. */
export function splitDays(rows: ebay.TrafficRow[], days: number, now = Date.now()): { current: ebay.TrafficRow[]; previous: ebay.TrafficRow[]; series: TrafficDay[] } {
  const today = ebayToday(now);
  const start = today - (days - 1) * DAY;
  const byDay = new Map(rows.map((r) => [dayKey(r.key), r]));
  const current = rows.filter((r) => Date.parse(`${dayKey(r.key)}T00:00:00Z`) >= start);
  const previous = rows.filter((r) => Date.parse(`${dayKey(r.key)}T00:00:00Z`) < start);
  const series = Array.from({ length: days }, (_, i) => {
    const day = new Date(start + i * DAY).toISOString().slice(0, 10);
    const r = byDay.get(day);
    return { day, impressions: n(r?.TOTAL_IMPRESSION_TOTAL), views: n(r?.LISTING_VIEWS_TOTAL), sold: n(r?.TRANSACTION) };
  });
  return { current, previous, series };
}

type Account = Parameters<typeof userToken>[0] & { id: string };

export async function trafficOverview(userId: string, account: Account, marketId: MarketplaceId, days: number, fresh = false): Promise<TrafficOverview> {
  const now = Date.now();
  const key = `traffic:${account.id}:${marketId}:${days}`;
  const hit = fresh ? null : await readState<TrafficOverview>(key);
  if (hit) return hit;
  const token = await userToken(account);
  const today = ebayToday(now);
  const to = new Date(today);
  const from = new Date(today - (2 * days - 1) * DAY);
  const dayRows = await ebay.getTrafficReport(token, { marketId, from, to, dimension: "DAY" });
  const { current, previous, series } = splitDays(dayRows, days, now);

  // Détail par annonce : annonces gérées par Sellvela + annonces créées sur eBay.
  const [ours, external] = await Promise.all([
    db.listing.findMany({ where: { userId, ebayAccountId: account.id, ebayListingId: { not: null }, status: { in: ["ACTIVE", "PAUSED"] } }, select: { ebayListingId: true, title: true } }),
    db.externalListing.findMany({ where: { userId, ebayAccountId: account.id }, select: { itemId: true, title: true } }),
  ]);
  const titles = new Map<string, string>([...external.map((e) => [e.itemId, e.title] as const), ...ours.map((l) => [l.ebayListingId!, l.title] as const)]);
  let listings: TrafficListing[] = [];
  if (titles.size) {
    const rows = await ebay
      .getTrafficReport(token, { marketId, from: new Date(today - (days - 1) * DAY), to, dimension: "LISTING", listingIds: [...titles.keys()] })
      .catch((e) => {
        console.error("Trafic par annonce", e);
        return [] as ebay.TrafficRow[];
      });
    listings = rows
      .map((r) => {
        const impressions = n(r.TOTAL_IMPRESSION_TOTAL);
        const views = n(r.LISTING_VIEWS_TOTAL);
        return { itemId: r.key, title: titles.get(r.key) ?? null, impressions, views, sold: n(r.TRANSACTION), ctr: pct(views, impressions) };
      })
      .sort((a, b) => b.impressions - a.impressions || b.views - a.views)
      .slice(0, 50);
  }
  const out: TrafficOverview = { days, current: sumTraffic(current), previous: sumTraffic(previous), series, listings, checkedAt: new Date(now).toISOString() };
  await writeState(key, out as unknown as Prisma.InputJsonValue, new Date(now + CACHE_MS));
  return out;
}
