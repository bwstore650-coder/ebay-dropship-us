/**
 * Préparation et publication d'une annonce eBay (côté serveur).
 * Tout ce qui compte (coût fournisseur, marge, marque protégée, limites) est recalculé ici :
 * on ne fait jamais confiance aux chiffres envoyés par le navigateur.
 */
import type { User } from "@prisma/client";
import { db } from "@/lib/db";
import { dailyListingLimit } from "@/lib/compliance";
import * as ebay from "@/lib/ebay";
import { EbayApiError } from "@/lib/ebay";
import { EbayReconnectRequired, userToken } from "@/lib/ebay-account";
import { getUsdRates, offersToCurrency } from "@/lib/fx";
import { computeMargin, landedCost, MAX_DELIVERY_DAYS, median, priceForTargetMargin, type SupplierOffer } from "@/lib/margin";
import { marketplace, type MarketplaceId } from "@/lib/marketplaces";
import { planInfo } from "@/lib/plans";
import { openSession, productInfo, quote, SupplierError, type ProductInfo, type SupplierId } from "@/lib/suppliers";
import { aiConfigured, htmlToText, supplierCopy, writeListingCopy, type AiLanguage, type ListingCopy } from "@/lib/ai";
import { AiLimitError, aiUsage, refundAiCredit, takeAiCredit } from "@/lib/ai-quota";
import { syncAds } from "@/lib/ads-service";
import { cachedDemand } from "@/lib/ebay-quota";
import { keywordFromTitle } from "@/lib/sniper";
import {
  buildAspects, cleanImages, cleanTitle, DEFAULT_QUANTITY, ebayItemUrl, isEuMarket, makeSku, mostCommon,
  sanitizeDescription, startOfUtcDay, veroIn,
} from "@/lib/listing";

export type ListingErrorCode =
  | "PLAN_REQUIRED" | "PLAN_LIMIT" | "EBAY_NOT_CONNECTED" | "EBAY_RECONNECT" | "EBAY_SETUP_REQUIRED" | "GPSR_REQUIRED"
  | "DAILY_LIMIT" | "SUPPLIER_UNSUPPORTED" | "SUPPLIER_RECONNECT" | "SUPPLIER_UNAVAILABLE" | "MARGIN_TOO_LOW" | "LISTING_BLOCKED"
  | "ASPECTS_MISSING" | "NO_IMAGES" | "NO_CATEGORY" | "EBAY_REJECTED" | "INVALID_INPUT" | "NOT_FOUND";

export class ListingError extends Error {
  constructor(readonly code: ListingErrorCode, readonly detail?: string) {
    super(detail ? `${code} : ${detail}` : code);
  }
}

type UserWithAccounts = User & {
  ebayAccounts: { id: string; accessToken: string; accessTokenExpires: Date; refreshToken: string; refreshTokenExpires: Date }[];
  supplierAccounts: { id?: string; supplier: string; accessToken: string; refreshToken?: string | null; expiresAt?: Date | null }[];
};

export interface SupplierRef {
  supplier: SupplierId;
  productId: string;
  variantId?: string;
}

interface LoadedVariant {
  info: ProductInfo;
  offer: SupplierOffer; // dans la devise du pays
}

/** Produit + variante chez le fournisseur, avec le stock local et la livraison la moins chère, convertis dans la devise du pays. */
async function loadVariant(user: UserWithAccounts, ref: SupplierRef, marketId: MarketplaceId): Promise<LoadedVariant> {
  const m = marketplace(marketId);
  let session;
  try {
    session = await openSession(user.supplierAccounts, ref.supplier);
  } catch (e) {
    if (e instanceof SupplierError) throw new ListingError(e.code === "SUPPLIER_RECONNECT" ? "SUPPLIER_RECONNECT" : "SUPPLIER_UNSUPPORTED");
    throw e;
  }
  const cache = new Map<string, Promise<unknown>>();
  const info = await productInfo(session, ref.productId, ref.variantId, m.country, cache);
  if (!info) throw new ListingError("SUPPLIER_UNAVAILABLE");
  const q = await quote(session, info.productId, info.variantId, 1, m.country, cache);
  if (q.kind !== "ok" || q.deliveryDaysMax > MAX_DELIVERY_DAYS) throw new ListingError("SUPPLIER_UNAVAILABLE");
  const usd: SupplierOffer = {
    supplier: ref.supplier,
    productId: info.productId,
    variantId: info.variantId,
    title: info.title,
    price: q.unitPrice,
    shipping: q.shipping,
    taxRate: q.taxRate,
    stockUs: q.stock,
    deliveryDaysMax: q.deliveryDaysMax,
  };
  const [offer] = m.currency === "USD" ? [usd] : offersToCurrency([usd], m.currency, await getUsdRates());
  return { info, offer };
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
  titles: string[];       // titres proposés par l'IA (le premier = title)
  /** Contexte pour régénérer titres / description sans rappeler le fournisseur ni eBay. */
  aiContext: { language: AiLanguage; productTitle: string; facts: string; variant?: string; comparableTitles: string[] };
  ai: { configured: boolean; used: number; limit: number; unlimited: boolean; note: "AI_LIMIT" | "AI_FAILED" | null };
}

/** Brouillon d'annonce : catégorie, textes rédigés par l'IA, caractéristiques, photos et prix conseillé. */
export async function prepareListing(user: UserWithAccounts, input: { keyword: string; marketId: MarketplaceId; ref: SupplierRef }): Promise<ListingDraft> {
  if (user.plan === "NONE") throw new ListingError("PLAN_REQUIRED");
  const m = marketplace(input.marketId);
  const { info, offer } = await loadVariant(user, input.ref, m.id);

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
    htmlToText(info.descriptionHtml),
    ...info.facts,
  ].filter(Boolean).join("\n");
  const copyInput = {
    language: m.listingLanguage,
    supplierTitle: info.title,
    supplierDescription: facts,
    variant: info.variantLabel,
    comparableTitles: market.items.slice(0, 8).map((i) => i.title),
    aspects: defs,
  };
  // IA : une génération du quota mensuel ; quota atteint ou échec → texte du fournisseur (rendu si l'IA a échoué).
  let aiNote: ListingDraft["ai"]["note"] = null;
  let copy: ListingCopy;
  if (aiConfigured()) {
    try {
      await takeAiCredit(user);
      copy = await writeListingCopy(copyInput);
      if (copy.source !== "ai") {
        aiNote = "AI_FAILED";
        await refundAiCredit(user);
      }
    } catch (e) {
      if (!(e instanceof AiLimitError)) throw e;
      aiNote = "AI_LIMIT";
      copy = supplierCopy(copyInput);
    }
  } else {
    copy = await writeListingCopy(copyInput);
  }
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
    ref: { supplier: input.ref.supplier, productId: info.productId, variantId: info.variantId },
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
    images: cleanImages(info.images),
    quantity: Math.min(DEFAULT_QUANTITY, offer.stockUs),
    maxQuantity: Math.min(10, offer.stockUs),
    cost,
    suggestedPrice: Math.round(suggestedPrice * 100) / 100,
    minPrice,
    minMarginPct: user.minMarginPct,
    copySource: copy.source,
    vero: veroIn(title, aspects),
    titles: copy.titles.map(cleanTitle),
    aiContext: {
      language: copyInput.language,
      productTitle: info.title.slice(0, 300),
      facts: facts.slice(0, 3000),
      variant: info.variantLabel,
      comparableTitles: copyInput.comparableTitles,
    },
    ai: aiConfigured() ? { configured: true, ...(await aiUsage(user)), note: aiNote } : { configured: false, used: 0, limit: 0, unlimited: false, note: null },
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
  keyword?: string; // recherche eBay du produit (repricing)
}

/** Publie l'annonce après avoir revérifié le coût fournisseur, la marge, les marques protégées et les limites. */
export async function publishListing(user: UserWithAccounts, input: PublishInput): Promise<{ listingId: string; url: string; id: string }> {
  if (user.plan === "NONE") throw new ListingError("PLAN_REQUIRED");
  const m = marketplace(input.marketId);
  const account = user.ebayAccounts.find((a) => a.id === input.ebayAccountId);
  if (!account) throw new ListingError("EBAY_NOT_CONNECTED");
  const saved = await db.ebayMarketSetup.findUnique({ where: { ebayAccountId_marketplaceId: { ebayAccountId: account.id, marketplaceId: m.id } } });
  if (!saved) throw new ListingError("EBAY_SETUP_REQUIRED");

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
  const { info, offer } = await loadVariant(user, input.ref, m.id);
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
  const images = cleanImages(info.images);
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
      supplier: input.ref.supplier,
      supplierProductId: info.productId,
      supplierVariantId: info.variantId,
      supplierCost: margin.landedCost,
      lastCheckedAt: new Date(),
      lastMarginPct: margin.marginPct,
      quantity,
      categoryId: input.categoryId,
      searchKeyword: input.keyword?.trim().slice(0, 120) || keywordFromTitle(title) || null,
      basePrice: price,
    },
  });

  try {
    const token = await userToken(account);
    // Politiques toujours présentes sur le compte eBay (réparées si possible), sinon le vendeur les rechoisit.
    const setup = await checkedSetup(saved, await ebay.getPolicies(token, m.id));
    if (!setup) throw new ListingError("EBAY_SETUP_REQUIRED");
    // Le lieu d'expédition peut avoir disparu chez eBay (compte eBay reconnecté, lieu supprimé dans Seller Hub) :
    // il est recréé à l'identique, sinon eBay refuse l'annonce (« Location information not found »).
    await ebay.ensureLocation(token, setup.merchantLocationKey, shipFromOf(setup, m.country));
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
    // Publicité automatique (si activée) : ne bloque jamais la mise en vente.
    if (user.adsEnabled) await syncAds(user, [listing.id]).catch((e) => console.error("Publicité", sku, e));
    return { id: listing.id, listingId, url: ebayItemUrl(m.id, listingId) };
  } catch (e) {
    const message = e instanceof EbayApiError ? e.readable : e instanceof Error ? e.message : String(e);
    if (!(e instanceof ListingError)) await db.listing.update({ where: { id: listing.id }, data: { errorMessage: message.slice(0, 1000) } });
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
  const [policies, saved] = await Promise.all([
    ebay.getPolicies(token, marketId),
    db.ebayMarketSetup.findUnique({ where: { ebayAccountId_marketplaceId: { ebayAccountId: account.id, marketplaceId: marketId } } }),
  ]);
  // Réglage qui pointe vers des politiques disparues : réparé si possible, sinon le vendeur les rechoisit.
  const existing = saved ? await checkedSetup(saved, policies) : null;
  return { policies, existing };
}

type MarketSetup = NonNullable<Awaited<ReturnType<typeof db.ebayMarketSetup.findUnique>>>;

/**
 * Les politiques enregistrées existent-elles encore sur le compte eBay ? (Compte reconnecté, politique supprimée
 * dans Seller Hub… : eBay refuse alors l'annonce, « invalid shipping policy ».) Une politique disparue est remplacée
 * par la seule politique de ce type du compte ; s'il y en a plusieurs, le vendeur doit choisir (null).
 */
export async function checkedSetup(setup: MarketSetup, policies: ebay.SellerPolicies): Promise<MarketSetup | null> {
  const pick = (list: ebay.PolicyOption[], id: string) => (list.some((x) => x.id === id) ? id : list.length === 1 ? list[0].id : null);
  const f = pick(policies.fulfillment, setup.fulfillmentPolicyId);
  const p = pick(policies.payment, setup.paymentPolicyId);
  const r = pick(policies.returns, setup.returnPolicyId);
  if (!f || !p || !r) return null;
  if (f === setup.fulfillmentPolicyId && p === setup.paymentPolicyId && r === setup.returnPolicyId) return setup;
  return db.ebayMarketSetup.update({ where: { id: setup.id }, data: { fulfillmentPolicyId: f, paymentPolicyId: p, returnPolicyId: r } });
}

/** Crée les politiques standard qui manquent au vendeur pour ce pays, puis renvoie les réglages à jour. */
export async function createStandardPolicies(user: UserWithAccounts, accountId: string, marketId: MarketplaceId) {
  const account = user.ebayAccounts.find((a) => a.id === accountId);
  if (!account) throw new ListingError("EBAY_NOT_CONNECTED");
  const token = await userToken(account);
  await ebay.optInBusinessPolicies(token);
  const current = await ebay.getPolicies(token, marketId);
  await ebay.createDefaultPolicies(token, marketId, {
    fulfillment: !current.fulfillment.length,
    payment: !current.payment.length,
    returns: !current.returns.length,
  });
  return setupOptions(user, accountId, marketId);
}

/** Adresse du lieu d'expédition d'un réglage (anciens réglages : code postal relu dans la clé « PL-US-91710 »). */
export function shipFromOf(
  setup: { merchantLocationKey: string; shipPostalCode?: string | null; shipCity?: string | null; shipState?: string | null },
  country: string,
): ebay.ShipFrom {
  const postal = setup.shipPostalCode || setup.merchantLocationKey.replace(/^PL-[A-Z]{2}-/, "");
  return { postalCode: postal, country, ...(setup.shipCity ? { city: setup.shipCity } : {}), ...(setup.shipState ? { stateOrProvince: setup.shipState } : {}) };
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
  // Annonces à quantité 0 masquées au lieu d'être terminées (utile pour la mise en pause automatique).
  await ebay.enableOutOfStockControl(token).catch((e) => console.error("Option rupture de stock", e));
  await ebay.ensureLocation(token, key, { postalCode: postal, city: i.city?.trim() || undefined, stateOrProvince: i.stateOrProvince?.trim() || undefined, country: m.country });
  const data = {
    fulfillmentPolicyId: i.fulfillmentPolicyId,
    paymentPolicyId: i.paymentPolicyId,
    returnPolicyId: i.returnPolicyId,
    merchantLocationKey: key,
    shipPostalCode: postal,
    shipCity: i.city?.trim() || null,
    shipState: i.stateOrProvince?.trim() || null,
  };
  await db.ebayMarketSetup.upsert({
    where: { ebayAccountId_marketplaceId: { ebayAccountId: account.id, marketplaceId: m.id } },
    create: { ebayAccountId: account.id, marketplaceId: m.id, ...data },
    update: data,
  });
}

/** Retire une annonce publiée (le client peut la republier plus tard). */
/** Supprime un brouillon jamais publié (échec de publication) : rien n'existe en vente sur eBay. */
export async function deleteDraft(user: { id: string }, listingId: string): Promise<boolean> {
  const r = await db.listing.deleteMany({ where: { id: listingId, userId: user.id, status: "DRAFT", ebayListingId: null } });
  return r.count > 0;
}

export async function endListing(user: UserWithAccounts, listingId: string) {
  const listing = await db.listing.findFirst({ where: { id: listingId, userId: user.id } });
  if (!listing) throw new ListingError("INVALID_INPUT");
  const account = user.ebayAccounts.find((a) => a.id === listing.ebayAccountId);
  if (listing.ebayOfferId && account && (listing.status === "ACTIVE" || listing.status === "PAUSED")) {
    await ebay.withdrawOffer(await userToken(account), listing.ebayOfferId, marketplace(listing.marketplace).id);
  }
  await db.listing.update({ where: { id: listing.id }, data: { status: "ENDED" } });
  // Annonce créée sur eBay : elle y reste, Sellvela arrête seulement de la gérer.
  if (listing.legacy) await db.externalListing.updateMany({ where: { listingId: listing.id }, data: { listingId: null } });
}


/* ---------- Amélioration d'une annonce publiée (IA) ---------- */

export interface ListingContent {
  id: string;
  title: string;
  descriptionHtml: string;
  aiContext: { language: AiLanguage; productTitle: string; facts: string; comparableTitles: string[] };
}

async function editableListing(user: UserWithAccounts, listingId: string) {
  const listing = await db.listing.findFirst({ where: { id: listingId, userId: user.id } });
  if (!listing) throw new ListingError("NOT_FOUND");
  if (!listing.ebayOfferId || !["ACTIVE", "PAUSED"].includes(listing.status)) throw new ListingError("INVALID_INPUT");
  const account = user.ebayAccounts.find((a) => a.id === listing.ebayAccountId);
  if (!account) throw new ListingError("EBAY_NOT_CONNECTED");
  return { listing, account, m: marketplace(listing.marketplace as MarketplaceId) };
}

/** Titre et description actuels (chez eBay), et le contexte pour que l'IA les réécrive. */
export async function listingContent(user: UserWithAccounts, listingId: string): Promise<ListingContent> {
  const { listing, account, m } = await editableListing(user, listingId);
  const token = await userToken(account);
  const [item, offer] = await Promise.all([ebay.getInventoryItem(token, listing.sku, m.id), ebay.getOffer(token, listing.ebayOfferId!, m.id)]);
  const product = (item.product ?? {}) as { title?: string; description?: string };
  const descriptionHtml = String(offer.listingDescription ?? product.description ?? "");
  const title = product.title ?? listing.title;
  // Annonces comparables (mots-clés que cherchent les acheteurs) : facultatif, depuis le cache partagé.
  let comparableTitles: string[] = [];
  if (listing.searchKeyword) {
    comparableTitles = await cachedDemand(listing.searchKeyword, 10, m.id)
      .then((d) => d.items.filter((i) => i.title !== title).slice(0, 8).map((i) => i.title))
      .catch(() => []);
  }
  return {
    id: listing.id,
    title,
    descriptionHtml,
    aiContext: { language: m.listingLanguage, productTitle: title, facts: htmlToText(descriptionHtml).slice(0, 3000) || title, comparableTitles },
  };
}

/** Envoie le nouveau titre et la nouvelle description à eBay (l'annonce en ligne est mise à jour). */
export async function updateListingContent(user: UserWithAccounts, listingId: string, input: { title: string; descriptionHtml: string }) {
  const { listing, account, m } = await editableListing(user, listingId);
  const title = cleanTitle(input.title);
  if (title.length < 10) throw new ListingError("INVALID_INPUT");
  const description = sanitizeDescription(input.descriptionHtml);
  if (description.replace(/<[^>]+>/g, "").trim().length < 20) throw new ListingError("INVALID_INPUT");
  const token = await userToken(account);
  try {
    const [item, offer] = await Promise.all([ebay.getInventoryItem(token, listing.sku, m.id), ebay.getOffer(token, listing.ebayOfferId!, m.id)]);
    const product = (item.product ?? {}) as { aspects?: Record<string, string[]> };
    const vero = veroIn(title, product.aspects ?? {});
    if (vero) throw new ListingError("LISTING_BLOCKED", vero);
    await ebay.replaceInventoryItem(token, listing.sku, { ...item, product: { ...(item.product as object), title, description } }, m.id);
    await ebay.replaceOffer(token, listing.ebayOfferId!, { ...offer, listingDescription: description }, m.id);
  } catch (e) {
    if (e instanceof ListingError) throw e;
    if (e instanceof EbayReconnectRequired || (e instanceof EbayApiError && e.status === 401)) throw new ListingError("EBAY_RECONNECT");
    if (e instanceof EbayApiError) throw new ListingError("EBAY_REJECTED", e.readable);
    throw e;
  }
  await db.listing.update({ where: { id: listing.id }, data: { title, errorMessage: null } });
  return { title };
}
