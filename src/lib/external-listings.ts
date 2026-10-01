/**
 * Annonces eBay créées en dehors de Sellvela : détection sur le compte du vendeur (API Trading),
 * puis liaison à un produit fournisseur pour que Sellvela les gère (stock, prix, commandes automatiques).
 */
import { db } from "@/lib/db";
import * as ebay from "@/lib/ebay";
import { userToken } from "@/lib/ebay-account";
import { convertFromUsd, getUsdRates } from "@/lib/fx";
import { computeMargin, landedCost } from "@/lib/margin";
import { EBAY_DOMAINS } from "@/lib/listing";
import { MARKETPLACE_IDS, marketplace, type MarketplaceId } from "@/lib/marketplaces";
import { openSession, quote, SupplierError, variantsOf, type SupplierId, type SupplierProductOptions } from "@/lib/suppliers";
import type { UserWithAccounts } from "@/lib/sniper-service";

export type ExternalErrorCode = "NOT_FOUND" | "INVALID_INPUT" | "HAS_VARIATIONS" | "ALREADY_LINKED" | "SUPPLIER_NOT_CONNECTED" | "PRODUCT_NOT_FOUND" | "EBAY_NOT_CONNECTED" | "RATE_LIMITED";
export class ExternalError extends Error {
  constructor(readonly code: ExternalErrorCode) {
    super(code);
  }
}

/** Synchronisation automatique au plus toutes les 6 h ; à la main, une fois par minute. */
export const AUTO_SYNC_MS = 6 * 3600_000;
export const MANUAL_SYNC_MS = 60_000;

/** Site eBay d'une annonce : d'après son lien (ebay.fr…), sinon d'après sa devise. */
export function marketOfItem(url: string | null, currency: string, fallback: MarketplaceId): MarketplaceId {
  const host = url?.match(/^https?:\/\/([^/]+)/i)?.[1]?.toLowerCase().replace(/^(?!www\.)/, "www.");
  if (host) {
    const hit = MARKETPLACE_IDS.find((id) => EBAY_DOMAINS[id] === host);
    if (hit) return hit;
  }
  const byCurrency = MARKETPLACE_IDS.filter((id) => marketplace(id).currency === currency);
  if (byCurrency.includes(fallback)) return fallback;
  return byCurrency[0] ?? fallback;
}

/** SKU libre pour l'annonce gérée (le SKU du vendeur s'il n'est pas déjà pris, sinon EXT-numéro d'annonce). */
async function freeSku(preferred: string | null, itemId: string, listingId?: string): Promise<string> {
  for (const sku of [preferred?.trim().slice(0, 50), `EXT-${itemId}`, `EXT-${itemId}-${Date.now().toString(36)}`]) {
    if (!sku) continue;
    const taken = await db.listing.findUnique({ where: { sku }, select: { id: true } });
    if (!taken || taken.id === listingId) return sku;
  }
  return `EXT-${itemId}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface SyncReport { accounts: number; found: number; ended: number; errors: number }

/**
 * Relit les annonces actives de chaque compte eBay : ajoute les nouvelles annonces créées hors de Sellvela,
 * retire celles qui ne sont plus en ligne (et termine leur gestion si elles étaient liées).
 */
export async function syncExternalListings(user: UserWithAccounts, now = Date.now()): Promise<SyncReport> {
  const report: SyncReport = { accounts: 0, found: 0, ended: 0, errors: 0 };
  const own = await db.listing.findMany({ where: { userId: user.id, legacy: false, ebayListingId: { not: null } }, select: { ebayListingId: true } });
  const ownIds = new Set(own.map((l) => l.ebayListingId!));
  const fallback = marketplace(user.defaultMarketplace).id;

  for (const account of user.ebayAccounts) {
    let items: ebay.ActiveItem[];
    try {
      items = await ebay.getActiveListings(await userToken(account));
    } catch (e) {
      report.errors++;
      console.error("Annonces eBay externes", account.id, e);
      continue; // lecture incomplète : on ne retire rien
    }
    report.accounts++;
    const seen = new Set<string>();
    for (const it of items) {
      if (!it.fixedPrice || ownIds.has(it.itemId)) continue;
      seen.add(it.itemId);
      const data = {
        marketplace: marketOfItem(it.url, it.currency, fallback),
        title: it.title.slice(0, 300),
        price: it.price,
        currency: it.currency,
        quantity: it.quantity,
        sku: it.sku?.slice(0, 80) ?? null,
        image: it.image && /^https:\/\//.test(it.image) ? it.image.slice(0, 500) : null,
        hasVariations: it.hasVariations,
        startedAt: it.startedAt ? new Date(it.startedAt) : null,
        syncedAt: new Date(now),
      };
      const row = await db.externalListing.upsert({
        where: { ebayAccountId_itemId: { ebayAccountId: account.id, itemId: it.itemId } },
        create: { userId: user.id, ebayAccountId: account.id, itemId: it.itemId, ...data },
        update: data,
      });
      // Annonce gérée : titre et prix suivent eBay (le vendeur a pu les changer sur eBay).
      if (row.listingId) await db.listing.updateMany({ where: { id: row.listingId, legacy: true }, data: { title: data.title, price: data.price } });
      report.found++;
    }
    // Plus en ligne sur eBay : la gestion s'arrête.
    const gone = await db.externalListing.findMany({ where: { ebayAccountId: account.id, itemId: { notIn: [...seen] } } });
    for (const g of gone) {
      if (g.listingId) {
        await db.listing.updateMany({ where: { id: g.listingId, legacy: true, status: { in: ["ACTIVE", "PAUSED"] } }, data: { status: "ENDED" } });
        report.ended++;
      }
    }
    if (gone.length) await db.externalListing.deleteMany({ where: { id: { in: gone.map((g) => g.id) } } });
  }
  return report;
}

export interface LinkPreview extends SupplierProductOptions {
  supplier: SupplierId;
  marketId: MarketplaceId;
  listingPrice: number;
  selected: {
    variantId: string;
    stock: number;
    available: boolean;       // en stock et livrable rapidement
    cost: number | null;      // coût livré (devise de l'annonce)
    profit: number | null;
    marginPct: number | null;
    deliveryDaysMax: number | null;
    belowMinMargin: boolean;  // l'annonce serait mise en pause par la surveillance
  } | null;
}

async function externalFor(userId: string, externalId: string) {
  const ext = await db.externalListing.findFirst({ where: { id: externalId, userId } });
  if (!ext) throw new ExternalError("NOT_FOUND");
  if (ext.hasVariations) throw new ExternalError("HAS_VARIATIONS");
  return ext;
}

async function session(user: UserWithAccounts, supplier: SupplierId) {
  try {
    return await openSession(user.supplierAccounts, supplier);
  } catch (e) {
    if (e instanceof SupplierError) throw new ExternalError("SUPPLIER_NOT_CONNECTED");
    throw e;
  }
}

/** Coût livré, bénéfice et marge de la variante choisie au prix actuel de l'annonce. */
async function evaluate(user: UserWithAccounts, s: Awaited<ReturnType<typeof session>>, productId: string, variantId: string, price: number, marketId: MarketplaceId) {
  const m = marketplace(marketId);
  const q = await quote(s, productId, variantId, 1, m.country);
  if (q.kind === "gone") return null;
  if (q.kind !== "ok") return { stock: q.kind === "no_route" ? q.stock : 0, available: false, cost: null, profit: null, marginPct: null, deliveryDaysMax: null, belowMinMargin: false };
  let unit = q.unitPrice;
  let ship = q.shipping;
  if (m.currency !== "USD") {
    const rates = await getUsdRates();
    unit = convertFromUsd(unit, m.currency, rates);
    ship = convertFromUsd(ship, m.currency, rates);
  }
  const cost = landedCost({ supplierCost: unit, supplierShipping: ship, supplierTaxRate: q.taxRate });
  const margin = computeMargin({ saleTotal: price, supplierCost: cost, market: m });
  return {
    stock: q.stock,
    available: q.deliveryDaysMax <= 8,
    cost,
    profit: margin.profit,
    marginPct: margin.marginPct,
    deliveryDaysMax: q.deliveryDaysMax,
    belowMinMargin: margin.marginPct < user.minMarginPct,
  };
}

/** Aperçu avant liaison : variantes du produit fournisseur et marge de la variante choisie (ou de la première). */
export async function previewLink(user: UserWithAccounts, externalId: string, input: { supplier: SupplierId; productId: string; variantId?: string }): Promise<LinkPreview> {
  const ext = await externalFor(user.id, externalId);
  const marketId = marketplace(ext.marketplace).id;
  const s = await session(user, input.supplier);
  const options = await variantsOf(s, input.productId, marketplace(marketId).country);
  if (!options || !options.variants.length) throw new ExternalError("PRODUCT_NOT_FOUND");
  const variant = options.variants.find((v) => v.id === input.variantId) ?? options.variants[0];
  const ev = await evaluate(user, s, options.productId, variant.id, ext.price, marketId);
  return {
    ...options,
    supplier: input.supplier,
    marketId,
    listingPrice: ext.price,
    selected: ev ? { variantId: variant.id, ...ev } : null,
  };
}

/**
 * Lie l'annonce eBay à une variante fournisseur : Sellvela la surveille (stock, marge, prix) et passe
 * automatiquement les commandes de ses ventes. L'annonce reste celle du vendeur sur eBay.
 */
export async function linkExternal(user: UserWithAccounts, externalId: string, input: { supplier: SupplierId; productId: string; variantId: string }) {
  const ext = await externalFor(user.id, externalId);
  const current = ext.listingId ? await db.listing.findFirst({ where: { id: ext.listingId, userId: user.id } }) : null;
  if (current && current.status !== "ENDED") throw new ExternalError("ALREADY_LINKED");
  const account = user.ebayAccounts.find((a) => a.id === ext.ebayAccountId);
  if (!account) throw new ExternalError("EBAY_NOT_CONNECTED");
  const marketId = marketplace(ext.marketplace).id;
  const s = await session(user, input.supplier);
  const ev = await evaluate(user, s, input.productId, input.variantId, ext.price, marketId);
  if (!ev) throw new ExternalError("PRODUCT_NOT_FOUND");

  // Sans l'option « rupture de stock », une quantité à 0 terminerait l'annonce au lieu de la mettre en pause.
  await ebay.enableOutOfStockControl(await userToken(account)).catch(() => false);

  // Une ancienne gestion de la même annonce est reprise (même SKU, historique des commandes conservé).
  const previous = current ?? (await db.listing.findFirst({ where: { userId: user.id, legacy: true, ebayListingId: ext.itemId } }));
  const data = {
    status: "ACTIVE" as const,
    ebayAccountId: account.id,
    marketplace: marketId,
    currency: ext.currency,
    ebayListingId: ext.itemId,
    ebayOfferId: null,
    legacy: true,
    title: ext.title,
    price: ext.price,
    basePrice: ext.price,
    quantity: Math.max(1, ext.quantity),
    supplier: input.supplier,
    supplierProductId: input.productId,
    supplierVariantId: input.variantId,
    supplierCost: ev.cost ?? 0,
    lastMarginPct: ev.marginPct,
    lastCheckedAt: null, // vérifiée au prochain passage de la surveillance
    pauseReason: null,
    pauseDetail: null,
    errorMessage: null,
    publishedAt: ext.startedAt ?? new Date(),
  };
  const listing = previous
    ? await db.listing.update({ where: { id: previous.id }, data: { ...data, sku: await freeSku(ext.sku, ext.itemId, previous.id) } })
    : await db.listing.create({ data: { ...data, userId: user.id, sku: await freeSku(ext.sku, ext.itemId) } });
  await db.externalListing.update({ where: { id: ext.id }, data: { listingId: listing.id } });
  return listing;
}

/** Arrête la gestion : l'annonce reste sur eBay telle quelle, Sellvela n'y touche plus et ne commande plus ses ventes. */
export async function unlinkExternal(user: { id: string }, externalId: string) {
  const ext = await db.externalListing.findFirst({ where: { id: externalId, userId: user.id } });
  if (!ext) throw new ExternalError("NOT_FOUND");
  if (ext.listingId) await db.listing.updateMany({ where: { id: ext.listingId, userId: user.id, legacy: true }, data: { status: "ENDED" } });
  await db.externalListing.update({ where: { id: ext.id }, data: { listingId: null } });
}

/* ---------- Quand synchroniser ---------- */

const syncKey = (userId: string) => `extsync:${userId}`;

/** Date de la dernière synchronisation réussie (null : jamais). */
export async function lastSync(userId: string): Promise<Date | null> {
  const row = await db.appState.findUnique({ where: { key: syncKey(userId) } });
  const at = (row?.value as { at?: string } | null)?.at;
  return at ? new Date(at) : null;
}

/** Synchronise si la dernière synchronisation date de plus de `minAgeMs` ; sinon RATE_LIMITED (à la main) ou rien (tâche planifiée). */
export async function syncIfDue(user: UserWithAccounts, minAgeMs: number, now = Date.now()): Promise<SyncReport | null> {
  if (!user.ebayAccounts.length) throw new ExternalError("EBAY_NOT_CONNECTED");
  const last = await lastSync(user.id);
  if (last && now - last.getTime() < minAgeMs) return null;
  const report = await syncExternalListings(user, now);
  if (report.accounts > 0) {
    const value = { at: new Date(now).toISOString() };
    await db.appState.upsert({
      where: { key: syncKey(user.id) },
      create: { key: syncKey(user.id), value, expiresAt: new Date(now + 30 * 86_400_000) },
      update: { value, expiresAt: new Date(now + 30 * 86_400_000) },
    });
  }
  return report;
}

/** Tâche planifiée : tous les vendeurs abonnés avec un compte eBay, dans la limite de temps. */
export async function syncAllExternal(deadline: number): Promise<number> {
  const users = await db.user.findMany({
    where: { plan: { not: "NONE" }, ebayAccounts: { some: {} } },
    include: { ebayAccounts: { orderBy: { createdAt: "asc" } }, supplierAccounts: true },
  });
  let done = 0;
  for (const u of users) {
    if (Date.now() > deadline) break;
    try {
      if (await syncIfDue(u, AUTO_SYNC_MS)) done++;
    } catch (e) {
      console.error("Annonces eBay externes", u.id, e);
    }
  }
  return done;
}
