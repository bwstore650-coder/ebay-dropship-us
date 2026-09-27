/**
 * Préparation et publication d'une annonce eBay (côté serveur).
 * Tout ce qui compte (coût fournisseur, marge, marque protégée, limites) est recalculé ici :
 * on ne fait jamais confiance aux chiffres envoyés par le navigateur.
 */
import type { User } from "@prisma/client";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { dailyListingLimit } from "@/lib/compliance";
import * as ebay from "@/lib/ebay";
import { EbayApiError } from "@/lib/ebay";
import { EbayReconnectRequired, userToken } from "@/lib/ebay-account";
import { getUsdRates, offersToCurrency } from "@/lib/fx";
import { computeMargin, landedCost, MAX_DELIVERY_DAYS, median, priceForTargetMargin, type SupplierOffer } from "@/lib/margin";
import { marketplace, type MarketplaceId } from "@/lib/marketplaces";
import { planInfo } from "@/lib/plans";
import * as cj from "@/lib/suppliers/cj";
import { htmlToText, writeListingCopy } from "@/lib/ai";
import {
  buildAspects, cleanImages, cleanTitle, DEFAULT_QUANTITY, ebayItemUrl, isEuMarket, makeSku, mostCommon,
  sanitizeDescription, startOfUtcDay, veroIn,
} from "@/lib/listing";

export type ListingErrorCode =
  | "PLAN_REQUIRED" | "PLAN_LIMIT" | "EBAY_NOT_CONNECTED" | "EBAY_RECONNECT" | "EBAY_SETUP_REQUIRED" | "GPSR_REQUIRED"
  | "DAILY_LIMIT" | "SUPPLIER_UNSUPPORTED" | "SUPPLIER_UNAVAILABLE" | "MARGIN_TOO_LOW" | "LISTING_BLOCKED"
  | "ASPECTS_MISSING" | "NO_IMAGES" | "NO_CATEGORY" | "EBAY_REJECTED" | "INVALID_INPUT";

export class ListingError extends Error {
  constructor(readonly code: ListingErrorCode, readonly detail?: string) {
    super(detail ? `${code} : ${detail}` : code);
  }
}

type UserWithAccounts = User & {
  ebayAccounts: { id: string; accessToken: string; accessTokenExpires: Date; refreshToken: string; refreshTokenExpires: Date }[];
  supplierAccounts: { supplier: string; accessToken: string }[];
};

export interface SupplierRef {
  supplier: "CJ" | "ALIEXPRESS";
  productId: string;
  variantId?: string;
}

interface LoadedVariant {
  product: cj.CjProduct;
  variant: cj.CjVariant;
  offer: SupplierOffer; // dans la devise du pays
}

/** Produit + variante chez CJ, avec le stock local et la livraison la moins chère, convertis dans la devise du pays. */
async function loadVariant(user: UserWithAccounts, ref: SupplierRef, marketId: MarketplaceId): Promise<LoadedVariant> {
  if (ref.supplier !== "CJ") throw new ListingError("SUPPLIER_UNSUPPORTED");
  const acc = user.supplierAccounts.find((a) => a.supplier === "CJ");
  if (!acc) throw new ListingError("SUPPLIER_UNSUPPORTED");
  const token = decrypt(acc.accessToken);
  const m = marketplace(marketId);
  const product = await cj.getProduct(token, ref.productId);
  const variant = product.variants.find((v) => v.vid === ref.variantId) ?? (ref.variantId ? undefined : product.variants[0]);
  if (!variant) throw new ListingError("SUPPLIER_UNAVAILABLE");
  const stock = variant.inventories?.find((i) => i.countryCode === m.country)?.totalInventory ?? 0;
  if (stock <= 0) throw new ListingError("SUPPLIER_UNAVAILABLE");
  const options = await cj.freightCalculate(token, variant.vid, 1, m.country);
  if (!options.length) throw new ListingError("SUPPLIER_UNAVAILABLE");
  const cheapest = options.reduce((a, b) => (b.logisticPrice < a.logisticPrice ? b : a));
  const usd: SupplierOffer = {
    supplier: "CJ",
    productId: product.pid,
    variantId: variant.vid,
    title: product.productNameEn,
    price: Number(variant.variantSellPrice),
    shipping: Number(cheapest.logisticPrice),
    stockUs: stock,
    deliveryDaysMax: cj.parseMaxDays(cheapest.logisticAging),
  };
  if (usd.deliveryDaysMax > MAX_DELIVERY_DAYS) throw new ListingError("SUPPLIER_UNAVAILABLE");
  const [offer] = m.currency === "USD" ? [usd] : offersToCurrency([usd], m.currency, await getUsdRates());
  return { product, variant, offer };
}

const offerCost = (o: SupplierOffer) => landedCost({ supplierCost: o.price, supplierShipping: o.shipping, supplierTaxRate: o.taxRate });

export interface ListingDraft {
  marketId: MarketplaceId;
  currency: string;
  symbol: string;
  ref: SupplierRef;
  title: string;
  descriptionHtml: string;
  aspects: Record<string, string[]>;
  aspectDefs: ebay.AspectDef[];
  missingRequired: string[];
  categoryId: string;
  categoryName: string | null;
  images: string[];
  quantity: number;
  maxQuantity: number;
  cost: number;           // coût livré (devise du pays)
  suggestedPrice: number;
  minPrice: number;       // prix minimum pour la marge du client
  minMarginPct: number;
  copySource: "ai" | "supplier";
  vero: string | null;
}

/** Brouillon d'annonce : catégorie, textes rédigés par l'IA, caractéristiques, photos et prix conseillé. */
export async function prepareListing(user: UserWithAccounts, input: { keyword: string; marketId: MarketplaceId; ref: SupplierRef }): Promise<ListingDraft> {
  if (user.plan === "NONE") throw new ListingError("PLAN_REQUIRED");
  const m = marketplace(input.marketId);
  const { product, variant, offer } = await loadVariant(user, input.ref, m.id);

  // Annonces comparables : mots-clés des titres qui vendent, catégorie la plus utilisée, prix du marché.
  const market = await ebay.searchActive(input.keyword, 50, m.id);
  let categoryId = mostCommon(market.items.slice(0, 20).map((i) => i.categoryId));
  let categoryName: string | null = null;
  if (!categoryId) {
    const s = await ebay.suggestCategory(input.keyword, m.id);
    categoryId = s?.id ?? null;
    categoryName = s?.name ?? null;
  }
  if (!categoryId) throw new ListingError("NO_CATEGORY");
  categoryName ??= await ebay.categoryName(categoryId, m.id);
  const defs = await ebay.getAspects(categoryId, m.id);

  const facts = [
    htmlToText(product.description ?? ""),
    product.materialNameEn ? `Material: ${product.materialNameEn}` : "",
    product.packingNameEn ? `Packing: ${product.packingNameEn}` : "",
  ].filter(Boolean).join("\n");
  const copy = await writeListingCopy({
    language: m.listingLanguage,
    supplierTitle: product.productNameEn,
    supplierDescription: facts,
    variant: variant.variantKey ?? variant.variantNameEn,
    comparableTitles: market.items.slice(0, 8).map((i) => i.title),
    aspects: defs,
  });
  const title = cleanTitle(copy.title);
  const { aspects, missingRequired } = buildAspects(copy.aspects, defs, m.id);

  const cost = offerCost(offer);
  const minPrice = priceForTargetMargin(cost, user.minMarginPct, { market: m });
  const marketPrice = median(market.prices);
  const suggestedPrice = Math.max(minPrice, marketPrice ?? 0);

  return {
    marketId: m.id,
    currency: m.currency,
    symbol: m.symbol,
    ref: { supplier: "CJ", productId: product.pid, variantId: variant.vid },
    title,
    descriptionHtml: sanitizeDescription(copy.descriptionHtml),
    aspects,
    // Seules les caractéristiques utiles sont envoyées à l'écran (listes de valeurs raccourcies).
    aspectDefs: defs
      .filter((d) => d.required || aspects[d.name])
      .map((d) => ({ ...d, values: d.values.slice(0, 200) })),
    missingRequired,
    categoryId,
    categoryName,
    images: cleanImages(cj.productImages(product, variant)),
    quantity: Math.min(DEFAULT_QUANTITY, offer.stockUs),
    maxQuantity: Math.min(10, offer.stockUs),
    cost,
    suggestedPrice: Math.round(suggestedPrice * 100) / 100,
    minPrice,
    minMarginPct: user.minMarginPct,
    copySource: copy.source,
    vero: veroIn(title, aspects),
  };
}



export interface PublishInput {
  ebayAccountId: string;
  marketId: MarketplaceId;
  ref: SupplierRef;
  categoryId: string;
  title: string;
  descriptionHtml: string;
  aspects: Record<string, string[]>;
  price: number;
  quantity: number;
}

/** Publie l'annonce après avoir revérifié le coût fournisseur, la marge, les marques protégées et les limites. */
export async function publishListing(user: UserWithAccounts, input: PublishInput): Promise<{ listingId: string; url: string; id: string }> {
  if (user.plan === "NONE") throw new ListingError("PLAN_REQUIRED");
  const m = marketplace(input.marketId);
  const account = user.ebayAccounts.find((a) => a.id === input.ebayAccountId);
  if (!account) throw new ListingError("EBAY_NOT_CONNECTED");
  const setup = await db.ebayMarketSetup.findUnique({ where: { ebayAccountId_marketplaceId: { ebayAccountId: account.id, marketplaceId: m.id } } });
  if (!setup) throw new ListingError("EBAY_SETUP_REQUIRED");

  const eu = isEuMarket(m.id);
  if (eu && !(user.euRpCompany && user.euRpAddress && user.euRpCity && user.euRpPostalCode && user.euRpCountry && user.euRpEmail))
    throw new ListingError("GPSR_REQUIRED");

  // Limites : par jour (âge du compte eBay) et par mois (formule).
  const listedToday = await db.listing.count({ where: { ebayAccountId: account.id, publishedAt: { gte: startOfUtcDay() } } });
  const dayLimit = dailyListingLimit(user.ebayAccountOpenedAt);
  if (listedToday >= dayLimit) throw new ListingError("DAILY_LIMIT", String(dayLimit));
  const monthly = planInfo(user.plan)?.listingsPerMonth ?? null;
  if (monthly !== null) {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const count = await db.listing.count({ where: { userId: user.id, publishedAt: { gte: monthStart } } });
    if (count >= monthly) throw new ListingError("PLAN_LIMIT", String(monthly));
  }

  // Coût fournisseur frais + marge au prix choisi.
  const { product, variant, offer } = await loadVariant(user, input.ref, m.id);
  const price = Math.round(input.price * 100) / 100;
  const margin = computeMargin({ saleTotal: price, supplierCost: offer.price, supplierShipping: offer.shipping, supplierTaxRate: offer.taxRate, market: m });
  if (margin.marginPct < user.minMarginPct) throw new ListingError("MARGIN_TOO_LOW", String(priceForTargetMargin(offerCost(offer), user.minMarginPct, { market: m })));

  // Contenu.
  const title = cleanTitle(input.title);
  if (title.length < 10) throw new ListingError("INVALID_INPUT");
  const description = sanitizeDescription(input.descriptionHtml);
  if (description.replace(/<[^>]+>/g, "").trim().length < 20) throw new ListingError("INVALID_INPUT");
  const defs = await ebay.getAspects(input.categoryId, m.id);
  const { aspects, missingRequired } = buildAspects(input.aspects, defs, m.id);
  if (missingRequired.length) throw new ListingError("ASPECTS_MISSING", missingRequired.join(", "));
  const vero = veroIn(title, aspects);
  if (vero) throw new ListingError("LISTING_BLOCKED", vero);
  const images = cleanImages(cj.productImages(product, variant));
  if (!images.length) throw new ListingError("NO_IMAGES");
  const quantity = Math.max(1, Math.min(Math.floor(input.quantity) || 1, 10, offer.stockUs));

  const sku = makeSku();
  const listing = await db.listing.create({
    data: {
      userId: user.id,
      ebayAccountId: account.id,
      status: "DRAFT",
      marketplace: m.id,
      currency: m.currency,
      sku,
      title,
      price,
      supplier: "CJ",
      supplierProductId: product.pid,
      supplierVariantId: variant.vid,
      supplierCost: margin.landedCost,
      lastCheckedAt: new Date(),
      lastMarginPct: margin.marginPct,
      categoryId: input.categoryId,
    },
  });

  try {
    const token = await userToken(account);
    await ebay.putInventoryItem(token, sku, { title, description, imageUrls: images, aspects, quantity }, m.id);
    const { offerId, listingId } = await ebay.createOrUpdateAndPublish(token, {
      marketId: m.id,
      sku,
      categoryId: input.categoryId,
      price,
      quantity,
      description,
      merchantLocationKey: setup.merchantLocationKey,
      fulfillmentPolicyId: setup.fulfillmentPolicyId,
      paymentPolicyId: setup.paymentPolicyId,
      returnPolicyId: setup.returnPolicyId,
      regulatory: eu
        ? {
            responsiblePersons: [{
              companyName: user.euRpCompany!,
              addressLine1: user.euRpAddress!,
              city: user.euRpCity!,
              postalCode: user.euRpPostalCode!,
              country: user.euRpCountry!,
              email: user.euRpEmail!,
              types: ["EUResponsiblePerson"],
            }],
          }
        : undefined,
    });
    await db.listing.update({
      where: { id: listing.id },
      data: { status: "ACTIVE", ebayOfferId: offerId, ebayListingId: listingId, publishedAt: new Date(), errorMessage: null },
    });
    return { id: listing.id, listingId, url: ebayItemUrl(m.id, listingId) };
  } catch (e) {
    const message = e instanceof EbayApiError ? e.readable : e instanceof Error ? e.message : String(e);
    await db.listing.update({ where: { id: listing.id }, data: { errorMessage: message.slice(0, 1000) } });
    if (e instanceof EbayReconnectRequired) throw new ListingError("EBAY_RECONNECT");
    if (e instanceof EbayApiError) {
      if (e.status === 401) throw new ListingError("EBAY_RECONNECT");
      throw new ListingError("EBAY_REJECTED", e.readable);
    }
    throw e;
  }
}

/* ---------- Réglages eBay par pays ---------- */

export async function setupOptions(user: UserWithAccounts, accountId: string, marketId: MarketplaceId) {
  const account = user.ebayAccounts.find((a) => a.id === accountId);
  if (!account) throw new ListingError("EBAY_NOT_CONNECTED");
  const token = await userToken(account);
  await ebay.optInBusinessPolicies(token);
  const [policies, existing] = await Promise.all([
    ebay.getPolicies(token, marketId),
    db.ebayMarketSetup.findUnique({ where: { ebayAccountId_marketplaceId: { ebayAccountId: account.id, marketplaceId: marketId } } }),
  ]);
  return { policies, existing };
}

export async function saveSetup(
  user: UserWithAccounts,
  i: { accountId: string; marketId: MarketplaceId; fulfillmentPolicyId: string; paymentPolicyId: string; returnPolicyId: string; postalCode: string; city?: string; stateOrProvince?: string },
) {
  const account = user.ebayAccounts.find((a) => a.id === i.accountId);
  if (!account) throw new ListingError("EBAY_NOT_CONNECTED");
  const m = marketplace(i.marketId);
  const token = await userToken(account);
  const p = await ebay.getPolicies(token, m.id);
  const has = (list: ebay.PolicyOption[], id: string) => list.some((x) => x.id === id);
  if (!has(p.fulfillment, i.fulfillmentPolicyId) || !has(p.payment, i.paymentPolicyId) || !has(p.returns, i.returnPolicyId))
    throw new ListingError("INVALID_INPUT");
  const postal = i.postalCode.trim().toUpperCase();
  const key = `PL-${m.country}-${postal.replace(/[^A-Z0-9]/g, "")}`.slice(0, 50);
  await ebay.ensureLocation(token, key, { postalCode: postal, city: i.city?.trim() || undefined, stateOrProvince: i.stateOrProvince?.trim() || undefined, country: m.country });
  const data = {
    fulfillmentPolicyId: i.fulfillmentPolicyId,
    paymentPolicyId: i.paymentPolicyId,
    returnPolicyId: i.returnPolicyId,
    merchantLocationKey: key,
  };
  await db.ebayMarketSetup.upsert({
    where: { ebayAccountId_marketplaceId: { ebayAccountId: account.id, marketplaceId: m.id } },
    create: { ebayAccountId: account.id, marketplaceId: m.id, ...data },
    update: data,
  });
}

/** Retire une annonce publiée (le client peut la republier plus tard). */
export async function endListing(user: UserWithAccounts, listingId: string) {
  const listing = await db.listing.findFirst({ where: { id: listingId, userId: user.id } });
  if (!listing) throw new ListingError("INVALID_INPUT");
  const account = user.ebayAccounts.find((a) => a.id === listing.ebayAccountId);
  if (listing.ebayOfferId && account && listing.status === "ACTIVE") {
    await ebay.withdrawOffer(await userToken(account), listing.ebayOfferId, marketplace(listing.marketplace).id);
  }
  await db.listing.update({ where: { id: listing.id }, data: { status: "ENDED" } });
}
