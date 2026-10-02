/**
 * Client eBay (API REST officielles) — EBAY_US par défaut, EBAY_CA / EBAY_GB / EBAY_AU via `marketId`.
 * OAuth « authorization code » pour le compte vendeur du client,
 * jeton « application » (client credentials) pour l'API Browse.
 */
import { env } from "@/lib/env";
import { marketplace, type MarketplaceId } from "@/lib/marketplaces";
import { monthlySales } from "@/lib/comparables";

const HOSTS = {
  sandbox: { auth: "https://auth.sandbox.ebay.com", api: "https://api.sandbox.ebay.com" },
  production: { auth: "https://auth.ebay.com", api: "https://api.ebay.com" },
} as const;

const host = () => HOSTS[env().EBAY_ENV];

/** Autorisations demandées aux comptes connectés avant l'ajout de la publicité (renouvellement de leurs jetons). */
export const LEGACY_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/sell.account",
];
export const MARKETING_SCOPE = "https://api.ebay.com/oauth/api_scope/sell.marketing";
export const SELLER_SCOPES = [...LEGACY_SCOPES, MARKETING_SCOPE];

/** Le compte a-t-il autorisé la publicité (Promoted Listings) ? */
export const canAdvertise = (scopes: string | null | undefined) => Boolean(scopes?.split(" ").includes(MARKETING_SCOPE));

function basicAuth() {
  const { EBAY_CLIENT_ID, EBAY_CLIENT_SECRET } = env();
  return "Basic " + Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString("base64");
}

/** Lien de consentement eBay (redirect_uri = le « RuName » de l'app eBay). */
export function authorizeUrl(state: string): string {
  const q = new URLSearchParams({
    client_id: env().EBAY_CLIENT_ID,
    redirect_uri: env().EBAY_RUNAME,
    response_type: "code",
    scope: SELLER_SCOPES.join(" "),
    state,
  });
  return `${host().auth}/oauth2/authorize?${q}`;
}

export interface EbayTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  token_type: string;
}

async function tokenRequest(body: Record<string, string>): Promise<EbayTokenResponse> {
  const res = await fetch(`${host().api}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basicAuth() },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new Error(`eBay OAuth ${res.status} : ${await res.text()}`);
  return res.json();
}

export function exchangeCode(code: string) {
  return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: env().EBAY_RUNAME });
}

/** Renouvelle le jeton avec les autorisations que le vendeur a réellement accordées (eBay refuse d'en demander plus). */
export function refreshUserToken(refreshToken: string, scopes?: string | null) {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken, scope: scopes || LEGACY_SCOPES.join(" ") });
}

let appToken: { token: string; expires: number } | null = null;
export async function getAppToken(): Promise<string> {
  if (appToken && appToken.expires > Date.now() + 60_000) return appToken.token;
  const t = await tokenRequest({ grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" });
  appToken = { token: t.access_token, expires: Date.now() + t.expires_in * 1000 };
  return appToken.token;
}

async function api<T>(token: string, path: string, init: RequestInit = {}, marketId: MarketplaceId = "EBAY_US"): Promise<T> {
  const m = marketplace(marketId);
  const res = await fetch(`${host().api}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Language": m.language,
      // Sinon fetch (Node) envoie « Accept-Language: * », que l'API Inventory d'eBay refuse.
      "Accept-Language": m.language,
      "X-EBAY-C-MARKETPLACE-ID": m.id,
      ...init.headers,
    },
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!res.ok) throw new EbayApiError(path, res.status, text);
  return (text ? JSON.parse(text) : undefined) as T;
}

export interface EbayErrorDetail {
  errorId?: number;
  message?: string;
  longMessage?: string;
  parameters?: { name: string; value: string }[];
}

/** Erreur renvoyée par eBay, avec les messages lisibles (à montrer au vendeur). */
export class EbayApiError extends Error {
  readonly errors: EbayErrorDetail[];
  constructor(readonly path: string, readonly status: number, body: string) {
    super(`eBay ${path} ${status} : ${body.slice(0, 2000)}`);
    let errors: EbayErrorDetail[] = [];
    try {
      errors = (JSON.parse(body) as { errors?: EbayErrorDetail[] }).errors ?? [];
    } catch {
      /* corps non JSON */
    }
    this.errors = errors;
  }
  /** Messages d'eBay, dédoublonnés, pour l'écran du vendeur. */
  get readable(): string {
    const msgs = this.errors.map((e) => e.longMessage || e.message).filter(Boolean) as string[];
    return [...new Set(msgs)].join(" · ") || `HTTP ${this.status}`;
  }
}

/** eBay a refusé l'appel parce que le quota de l'application est atteint (HTTP 429 / errorId 2001). */
export function isQuotaError(e: unknown): boolean {
  return e instanceof EbayApiError && (e.status === 429 || e.errors.some((x) => x.errorId === 2001));
}

export interface BrowseQuota {
  limit: number;
  remaining: number;
  reset: string | null; // ISO : remise à zéro du compteur
}

/** Quota du jour de l'API Browse (API Analytics d'eBay, gratuite et non décomptée). */
export async function getBrowseQuota(): Promise<BrowseQuota | null> {
  const data = await api<{
    rateLimits?: { apiName?: string; resources?: { name?: string; rates?: { limit?: number; remaining?: number; reset?: string }[] }[] }[];
  }>(await getAppToken(), `/developer/analytics/v1_beta/rate_limit/?${new URLSearchParams({ api_context: "buy", api_name: "Browse" })}`);
  const rates = (data.rateLimits ?? []).flatMap((r) => r.resources ?? []).flatMap((r) => r.rates ?? []);
  if (!rates.length) return null;
  // Plusieurs ressources (search, item…) : la plus limitée décide.
  const tight = rates.reduce((a, b) => ((b.remaining ?? Infinity) < (a.remaining ?? Infinity) ? b : a));
  return { limit: tight.limit ?? 0, remaining: tight.remaining ?? 0, reset: tight.reset ?? null };
}

/* ---------- Recherche (API Browse) : prix des annonces actives neuves dans le pays ---------- */

interface ItemSummary {
  itemId: string;
  title: string;
  price?: { value: string; currency: string };
  shippingOptions?: { shippingCost?: { value: string } }[];
  itemWebUrl?: string;
  image?: { imageUrl: string };
  leafCategoryIds?: string[];
  itemCreationDate?: string;
}

export interface MarketSnapshot {
  total: number;
  prices: number[]; // prix total acheteur (produit + livraison)
  items: { id: string; title: string; price: number; url?: string; image?: string; categoryId?: string; createdAt?: string }[];
}

export async function searchActive(q: string, limit = 50, marketId: MarketplaceId = "EBAY_US"): Promise<MarketSnapshot> {
  const m = marketplace(marketId);
  const token = await getAppToken();
  const params = new URLSearchParams({
    q,
    limit: String(limit),
    filter: `buyingOptions:{FIXED_PRICE},conditions:{NEW},itemLocationCountry:${m.country},priceCurrency:${m.currency}`,
  });
  const data = await api<{ total: number; itemSummaries?: ItemSummary[] }>(token, `/buy/browse/v1/item_summary/search?${params}`, {}, m.id);
  const items = (data.itemSummaries ?? []).map((i) => {
    const ship = Number(i.shippingOptions?.[0]?.shippingCost?.value ?? 0);
    return {
      id: i.itemId,
      title: i.title,
      price: Number(i.price?.value ?? 0) + ship,
      url: i.itemWebUrl,
      image: i.image?.imageUrl,
      categoryId: i.leafCategoryIds?.[0],
      createdAt: i.itemCreationDate,
    };
  });
  return { total: data.total, prices: items.map((i) => i.price).filter((p) => p > 0), items };
}

/** Filtre commun : annonces neuves à prix fixe, situées dans le pays, dans sa devise (+ gamme de prix). */
function marketFilter(m: ReturnType<typeof marketplace>, price?: { min: number | null; max: number | null }) {
  const f = [`buyingOptions:{FIXED_PRICE}`, `conditions:{NEW}`, `itemLocationCountry:${m.country}`, `priceCurrency:${m.currency}`];
  if (price && (price.min !== null || price.max !== null)) f.push(`price:[${price.min ?? ""}..${price.max ?? ""}]`);
  return f.join(",");
}

const toListing = (i: ItemSummary) => ({
  id: i.itemId,
  title: i.title,
  price: Number(i.price?.value ?? 0) + Number(i.shippingOptions?.[0]?.shippingCost?.value ?? 0),
  url: i.itemWebUrl,
  image: i.image?.imageUrl,
  categoryId: i.leafCategoryIds?.[0],
  createdAt: i.itemCreationDate,
});

/** Recherche par image (photo en base64) : annonces classées de la plus ressemblante à la moins ressemblante. */
export async function searchByImage(imageBase64: string, limit = 50, marketId: MarketplaceId = "EBAY_US"): Promise<MarketSnapshot> {
  const m = marketplace(marketId);
  const params = new URLSearchParams({ limit: String(limit), filter: marketFilter(m) });
  const data = await api<{ total?: number; itemSummaries?: ItemSummary[] }>(
    await getAppToken(),
    `/buy/browse/v1/item_summary/search_by_image?${params}`,
    { method: "POST", body: JSON.stringify({ image: imageBase64 }) },
    m.id,
  );
  const items = (data.itemSummaries ?? []).map(toListing);
  return { total: data.total ?? items.length, prices: items.map((i) => i.price).filter((p) => p > 0), items };
}

export interface EbayItemSales {
  itemId: string;
  title: string;
  price: number;           // prix + livraison
  currency: string;
  image: string | null;
  createdAt: string | null;
  sold: number;            // ventes estimées par eBay depuis la mise en ligne (toutes variantes)
  variations: number;      // 1 : annonce simple
}

type RawItem = ItemSummary & { estimatedAvailabilities?: { estimatedSoldQuantity?: number }[]; categoryId?: string };

/** Une annonce par son numéro (celui de l'adresse ebay.com/itm/…), variantes comprises. Null : annonce introuvable. */
export async function getItemSales(itemId: string, marketId: MarketplaceId = "EBAY_US"): Promise<EbayItemSales | null> {
  const token = await getAppToken();
  const sold = (i: RawItem) => i.estimatedAvailabilities?.reduce((s, a) => s + (a.estimatedSoldQuantity ?? 0), 0) ?? 0;
  const shape = (items: RawItem[]): EbayItemSales => {
    const first = items[0];
    return {
      itemId,
      title: first.title,
      price: Number(first.price?.value ?? 0) + Number(first.shippingOptions?.[0]?.shippingCost?.value ?? 0),
      currency: first.price?.currency ?? marketplace(marketId).currency,
      image: first.image?.imageUrl ?? null,
      createdAt: first.itemCreationDate ?? null,
      sold: items.reduce((s, i) => s + sold(i), 0),
      variations: items.length,
    };
  };
  try {
    const item = await api<RawItem>(token, `/buy/browse/v1/item/get_item_by_legacy_id?${new URLSearchParams({ legacy_item_id: itemId })}`, {}, marketId);
    return shape([item]);
  } catch (e) {
    if (isQuotaError(e) || !(e instanceof EbayApiError)) throw e;
    // Annonce à variantes : eBay demande de la lire comme un groupe.
    if (e.errors.some((x) => x.errorId === 11006)) {
      const g = await api<{ items?: RawItem[] }>(token, `/buy/browse/v1/item/get_items_by_item_group?${new URLSearchParams({ item_group_id: itemId })}`, {}, marketId);
      return g.items?.length ? shape(g.items) : null;
    }
    if (e.status === 404 || e.errors.some((x) => x.errorId === 11001)) return null;
    throw e;
  }
}

/** Nombre d'annonces actives pour une recherche précise (mots-clés + catégorie + gamme de prix), en un appel. */
export async function countActive(q: string, opts: { categoryId?: string | null; priceMin?: number | null; priceMax?: number | null }, marketId: MarketplaceId = "EBAY_US"): Promise<number> {
  const m = marketplace(marketId);
  const params = new URLSearchParams({ q, limit: "1", filter: marketFilter(m, { min: opts.priceMin ?? null, max: opts.priceMax ?? null }) });
  if (opts.categoryId) params.set("category_ids", opts.categoryId);
  const data = await api<{ total?: number }>(await getAppToken(), `/buy/browse/v1/item_summary/search?${params}`, {}, m.id);
  return data.total ?? 0;
}

/**
 * Ventes estimées d'une annonce (API Browse getItem → estimatedAvailabilities.estimatedSoldQuantity).
 * Source officielle et gratuite ; c'est une estimation d'eBay, cumulée sur la vie de l'annonce.
 */
export async function getSoldQuantity(itemId: string, marketId: MarketplaceId = "EBAY_US"): Promise<number> {
  const token = await getAppToken();
  const data = await api<{ estimatedAvailabilities?: { estimatedSoldQuantity?: number }[] }>(
    token,
    `/buy/browse/v1/item/${encodeURIComponent(itemId)}`,
    {},
    marketId,
  );
  return data.estimatedAvailabilities?.reduce((s, a) => s + (a.estimatedSoldQuantity ?? 0), 0) ?? 0;
}

/* ---------- Recherche marché (espion de concurrents, Title Builder, meilleures ventes) ---------- */

export interface BrowseItem {
  id: string;
  title: string;
  price: number;          // prix + livraison
  currency: string;
  url?: string;
  image?: string;
  categoryId?: string;
  seller?: { username: string; feedbackScore?: number; feedbackPercentage?: number };
}

interface RawSummary extends ItemSummary {
  seller?: { username?: string; feedbackScore?: number; feedbackPercentage?: string };
}

/**
 * Recherche Browse générique (annonces neuves à prix fixe du pays).
 * `q` ou `categoryId` est obligatoire ; `seller` limite aux annonces d'un vendeur.
 */
export async function browseSearch(
  opts: { q?: string; categoryId?: string; seller?: string; limit?: number; offset?: number; newOnly?: boolean },
  marketId: MarketplaceId = "EBAY_US",
): Promise<{ total: number; items: BrowseItem[] }> {
  const m = marketplace(marketId);
  const filters = [`buyingOptions:{FIXED_PRICE}`, `priceCurrency:${m.currency}`];
  if (opts.newOnly !== false) filters.push("conditions:{NEW}");
  if (opts.seller) filters.push(`sellers:{${opts.seller.replace(/[{}|,]/g, "")}}`);
  else filters.push(`itemLocationCountry:${m.country}`);
  const params = new URLSearchParams({ limit: String(opts.limit ?? 50), offset: String(opts.offset ?? 0), filter: filters.join(",") });
  if (opts.q) params.set("q", opts.q);
  if (opts.categoryId) params.set("category_ids", opts.categoryId);
  const data = await api<{ total?: number; itemSummaries?: RawSummary[] }>(await getAppToken(), `/buy/browse/v1/item_summary/search?${params}`, {}, m.id);
  const items = (data.itemSummaries ?? []).map((i) => ({
    id: i.itemId,
    title: i.title,
    price: Math.round((Number(i.price?.value ?? 0) + Number(i.shippingOptions?.[0]?.shippingCost?.value ?? 0)) * 100) / 100,
    currency: i.price?.currency ?? m.currency,
    url: i.itemWebUrl,
    image: i.image?.imageUrl,
    categoryId: i.leafCategoryIds?.[0],
    seller: i.seller?.username
      ? { username: i.seller.username, feedbackScore: i.seller.feedbackScore, feedbackPercentage: i.seller.feedbackPercentage ? Number(i.seller.feedbackPercentage) : undefined }
      : undefined,
  }));
  return { total: data.total ?? items.length, items };
}

/**
 * Ventes estimées de plusieurs annonces (estimation eBay, cumulée depuis la mise en ligne).
 * Par lots de 20 avec getItems ; si la méthode n'est pas disponible, une annonce à la fois (5 en parallèle).
 */
let batchRefused = false; // getItems refusé à cette application : inutile de le retenter (un appel gaspillé à chaque fois)
export async function soldQuantities(ids: string[], marketId: MarketplaceId = "EBAY_US"): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const token = await getAppToken();
  let batchOk = !batchRefused;
  for (let i = 0; i < ids.length && batchOk; i += 20) {
    const chunk = ids.slice(i, i + 20);
    try {
      const d = await api<{ items?: { itemId: string; estimatedAvailabilities?: { estimatedSoldQuantity?: number }[] }[] }>(
        token,
        `/buy/browse/v1/item/?${new URLSearchParams({ item_ids: chunk.join(",") })}`,
        {},
        marketId,
      );
      for (const it of d.items ?? []) out.set(it.itemId, it.estimatedAvailabilities?.reduce((s, a) => s + (a.estimatedSoldQuantity ?? 0), 0) ?? 0);
    } catch (e) {
      if (isQuotaError(e)) throw e;
      if (e instanceof EbayApiError && (e.status === 403 || e.status === 401)) batchRefused = true;
      batchOk = false;
    }
  }
  const missing = ids.filter((id) => !out.has(id));
  for (let i = 0; i < missing.length; i += 5) {
    await Promise.all(
      missing.slice(i, i + 5).map(async (id) => {
        try {
          out.set(id, await getSoldQuantity(id, marketId));
        } catch (e) {
          // Quota atteint : on arrête tout (sinon le produit serait faussement classé « pas de ventes »).
          if (isQuotaError(e)) throw e;
          /* annonce retirée entre-temps */
        }
      }),
    );
  }
  return out;
}

export interface DemandSnapshot extends MarketSnapshot {
  unitsSold: number;                                  // total estimé sur les annonces analysées
  soldWeighted: { price: number; weight: number }[]; // prix × unités vendues
  analyzed: (MarketSnapshot["items"][number] & { sold: number })[]; // annonces analysées, avec leurs ventes
  monthlySales?: number | null;                       // ventes estimées par mois (annonces analysées)
  method?: "IMAGE" | "KEYWORD";                       // comment les annonces comparables ont été trouvées
  search?: { q: string; categoryId: string | null; priceMin: number | null; priceMax: number | null; cost?: number | null }; // recherche précise (concurrents) ; cost = prix fournisseur de référence
}

/** Marché + demande : prix des annonces actives, pondérés par ce qu'elles ont réellement vendu. */
export async function searchWithDemand(q: string, sample = 20, marketId: MarketplaceId = "EBAY_US"): Promise<DemandSnapshot> {
  const market = await searchActive(q, 50, marketId);
  const sampled = market.items.slice(0, sample);
  const sold = await soldQuantities(sampled.map((i) => i.id), marketId);
  // Annonce retirée entre-temps : absente de la liste, on l'ignore.
  const analyzed = sampled.filter((i) => sold.has(i.id)).map((i) => ({ ...i, sold: sold.get(i.id)! }));
  const soldWeighted = analyzed.map((i) => ({ price: i.price, weight: i.sold }));
  return { ...market, soldWeighted, analyzed, unitsSold: soldWeighted.reduce((s, p) => s + p.weight, 0), monthlySales: monthlySales(analyzed), method: "KEYWORD", search: { q, categoryId: null, priceMin: null, priceMax: null } };
}

/* ---------- Mise en vente (API Inventory) ---------- */

export interface InventoryItemInput {
  title: string;          // ≤ 80 caractères
  description: string;    // HTML
  imageUrls: string[];
  aspects?: Record<string, string[]>;
  quantity: number;
}

export function putInventoryItem(token: string, sku: string, i: InventoryItemInput, marketId: MarketplaceId = "EBAY_US") {
  return api<void>(token, `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
    method: "PUT",
    body: JSON.stringify({
      condition: "NEW",
      product: { title: i.title.slice(0, 80), description: i.description, imageUrls: i.imageUrls, aspects: i.aspects },
      availability: { shipToLocationAvailability: { quantity: i.quantity } },
    }),
  }, marketId);
}

export interface Regulatory {
  responsiblePersons?: {
    companyName: string;
    addressLine1: string;
    city: string;
    postalCode: string;
    country: string;
    email: string;
    types: ["EUResponsiblePerson"];
  }[];
}

export interface OfferInput {
  marketId?: MarketplaceId;
  sku: string;
  categoryId: string;
  price: number; // dans la devise du pays
  quantity: number;
  description: string;
  merchantLocationKey: string;
  fulfillmentPolicyId: string;
  paymentPolicyId: string;
  returnPolicyId: string;
  regulatory?: Regulatory;
}

function offerBody(o: OfferInput) {
  const m = marketplace(o.marketId);
  return {
    sku: o.sku,
    marketplaceId: m.id,
    format: "FIXED_PRICE",
    listingDuration: "GTC",
    availableQuantity: o.quantity,
    categoryId: o.categoryId,
    listingDescription: o.description,
    merchantLocationKey: o.merchantLocationKey,
    pricingSummary: { price: { value: o.price.toFixed(2), currency: m.currency } },
    listingPolicies: {
      fulfillmentPolicyId: o.fulfillmentPolicyId,
      paymentPolicyId: o.paymentPolicyId,
      returnPolicyId: o.returnPolicyId,
    },
    ...(o.regulatory ? { regulatory: o.regulatory } : {}),
  };
}

export function createOffer(token: string, o: OfferInput) {
  const m = marketplace(o.marketId);
  return api<{ offerId: string }>(token, "/sell/inventory/v1/offer", { method: "POST", body: JSON.stringify(offerBody(o)) }, m.id);
}

export function updateOffer(token: string, offerId: string, o: OfferInput) {
  const m = marketplace(o.marketId);
  return api<void>(token, `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`, { method: "PUT", body: JSON.stringify(offerBody(o)) }, m.id);
}

/* ---------- Mise à jour du contenu d'une annonce publiée (titre, description) ---------- */

type Json = Record<string, unknown>;

/** Article d'inventaire tel qu'eBay le renvoie. */
export function getInventoryItem(token: string, sku: string, marketId: MarketplaceId) {
  return api<Json>(token, `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {}, marketId);
}

/** Remplace l'article (eBay met à jour l'annonce publiée) ; seuls les champs acceptés par eBay sont renvoyés. */
export function replaceInventoryItem(token: string, sku: string, item: Json, marketId: MarketplaceId) {
  const keep = ["availability", "condition", "conditionDescription", "conditionDescriptors", "packageWeightAndSize", "product"];
  const body = Object.fromEntries(Object.entries(item).filter(([k]) => keep.includes(k)));
  return api<void>(token, `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, { method: "PUT", body: JSON.stringify(body) }, marketId);
}

export function getOffer(token: string, offerId: string, marketId: MarketplaceId) {
  return api<Json>(token, `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`, {}, marketId);
}

/** Remplace l'offre (eBay met à jour l'annonce publiée) ; seuls les champs modifiables sont renvoyés. */
export function replaceOffer(token: string, offerId: string, offer: Json, marketId: MarketplaceId) {
  const keep = [
    "availableQuantity", "categoryId", "charity", "extendedProducerResponsibility", "hideBuyerDetails", "includeCatalogProductDetails",
    "listingDescription", "listingDuration", "listingPolicies", "listingStartDate", "lotSize", "merchantLocationKey", "pricingSummary",
    "quantityLimitPerBuyer", "regulatory", "secondaryCategoryId", "storeCategoryNames", "tax",
  ];
  const body = Object.fromEntries(Object.entries(offer).filter(([k]) => keep.includes(k)));
  return api<void>(token, `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`, { method: "PUT", body: JSON.stringify(body) }, marketId);
}

/** Offre déjà créée pour ce SKU dans ce pays (après un essai qui a échoué à la publication), sinon null. */
export async function findOfferId(token: string, sku: string, marketId: MarketplaceId): Promise<string | null> {
  const q = new URLSearchParams({ sku, marketplace_id: marketId });
  try {
    const data = await api<{ offers?: { offerId: string }[] }>(token, `/sell/inventory/v1/offer?${q}`, {}, marketId);
    return data.offers?.[0]?.offerId ?? null;
  } catch (e) {
    if (e instanceof EbayApiError && (e.status === 404 || e.status === 400)) return null;
    throw e;
  }
}

/** Crée l'offre, ou met à jour celle qui existe déjà pour ce SKU, puis la publie. */
export async function createOrUpdateAndPublish(token: string, o: OfferInput): Promise<{ offerId: string; listingId: string }> {
  const m = marketplace(o.marketId);
  let offerId = await findOfferId(token, o.sku, m.id);
  if (offerId) await updateOffer(token, offerId, o);
  else offerId = (await createOffer(token, o)).offerId;
  const { listingId } = await publishOffer(token, offerId, m.id);
  return { offerId, listingId };
}

export function publishOffer(token: string, offerId: string, marketId: MarketplaceId = "EBAY_US") {
  return api<{ listingId: string }>(token, `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`, { method: "POST" }, marketId);
}

/** Quantités (et prix) de plusieurs annonces d'un coup : 25 au maximum par appel. */
export async function bulkUpdateQuantity(
  token: string,
  items: { sku: string; offerId: string; quantity: number; price?: { value: number; currency: string } }[],
): Promise<{ sku: string; ok: boolean; message?: string }[]> {
  const out: { sku: string; ok: boolean; message?: string }[] = [];
  for (let i = 0; i < items.length; i += 25) {
    const chunk = items.slice(i, i + 25);
    const d = await api<{ responses?: { sku?: string; offerId?: string; statusCode?: number; errors?: EbayErrorDetail[] }[] }>(
      token,
      "/sell/inventory/v1/bulk_update_price_quantity",
      {
        method: "POST",
        body: JSON.stringify({
          requests: chunk.map((c) => ({
            sku: c.sku,
            shipToLocationAvailability: { quantity: c.quantity },
            offers: [{ offerId: c.offerId, availableQuantity: c.quantity, ...(c.price ? { price: { value: c.price.value.toFixed(2), currency: c.price.currency } } : {}) }],
          })),
        }),
      },
    );
    for (const c of chunk) {
      const rs = (d.responses ?? []).filter((r) => r.sku === c.sku || r.offerId === c.offerId);
      const bad = rs.find((r) => (r.statusCode ?? 200) >= 400);
      out.push(bad ? { sku: c.sku, ok: false, message: bad.errors?.map((e) => e.longMessage || e.message).join(" · ") } : { sku: c.sku, ok: true });
    }
  }
  return out;
}

/**
 * Active l'option « rupture de stock » du vendeur (API Trading SetUserPreferences) :
 * une annonce à quantité 0 reste en ligne mais masquée, et garde son historique de ventes.
 */
export async function enableOutOfStockControl(token: string): Promise<boolean> {
  const res = await fetch(`${host().api}/ws/api.dll`, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": "SetUserPreferences",
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1349",
      "X-EBAY-API-IAF-TOKEN": token,
    },
    body: '<?xml version="1.0" encoding="utf-8"?><SetUserPreferencesRequest xmlns="urn:ebay:apis:eBLBaseComponents"><OutOfStockControlPreference>true</OutOfStockControlPreference></SetUserPreferencesRequest>',
  });
  const text = await res.text();
  return res.ok && /<Ack>(Success|Warning)<\/Ack>/.test(text);
}

/* ---------- Réglages du compte (API Account) ---------- */

export interface PolicyOption { id: string; name: string }
export interface SellerPolicies { fulfillment: PolicyOption[]; payment: PolicyOption[]; returns: PolicyOption[] }

/** Active les « politiques professionnelles » du vendeur (sans effet si c'est déjà fait). */
export async function optInBusinessPolicies(token: string): Promise<void> {
  try {
    await api<void>(token, "/sell/account/v1/program/opt_in", { method: "POST", body: JSON.stringify({ programType: "SELLING_POLICY_MANAGEMENT" }) });
  } catch (e) {
    if (!(e instanceof EbayApiError) || e.status >= 500) throw e; // déjà inscrit : eBay répond par une erreur 4xx
  }
}

type RawPolicy = { name: string; categoryTypes?: { name: string }[] } & Record<string, unknown>;

/** Politiques utilisables pour des produits classiques (hors véhicules). */
function usable(list: RawPolicy[] | undefined, idKey: string): PolicyOption[] {
  return (list ?? [])
    .filter((p) => !p.categoryTypes?.length || p.categoryTypes.some((c) => c.name === "ALL_EXCLUDING_MOTORS_VEHICLES"))
    .map((p) => ({ id: String(p[idKey]), name: p.name }));
}

export async function getPolicies(token: string, marketId: MarketplaceId): Promise<SellerPolicies> {
  const q = `marketplace_id=${marketId}`;
  const [f, p, r] = await Promise.all([
    api<{ fulfillmentPolicies?: RawPolicy[] }>(token, `/sell/account/v1/fulfillment_policy?${q}`, {}, marketId),
    api<{ paymentPolicies?: RawPolicy[] }>(token, `/sell/account/v1/payment_policy?${q}`, {}, marketId),
    api<{ returnPolicies?: RawPolicy[] }>(token, `/sell/account/v1/return_policy?${q}`, {}, marketId),
  ]);
  return {
    fulfillment: usable(f.fulfillmentPolicies, "fulfillmentPolicyId"),
    payment: usable(p.paymentPolicies, "paymentPolicyId"),
    returns: usable(r.returnPolicies, "returnPolicyId"),
  };
}

/* ---------- Politiques standard créées automatiquement (vendeur qui n'en a pas encore) ---------- */

export interface ShippingServiceOption { code: string; category: string; carrier: string | null; maxDays: number | null }

const tag = (block: string, name: string) => block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]?.trim() ?? null;

/** Services de livraison nationaux au forfait, utilisables à la mise en vente (réponse GeteBayDetails). */
export function parseShippingServices(xml: string): ShippingServiceOption[] {
  const out: ShippingServiceOption[] = [];
  for (const m of xml.matchAll(/<ShippingServiceDetails>([\s\S]*?)<\/ShippingServiceDetails>/g)) {
    const b = m[1];
    const code = tag(b, "ShippingService");
    if (!code || tag(b, "ValidForSellingFlow") !== "true" || tag(b, "InternationalService") === "true") continue;
    const types = [...b.matchAll(/<ServiceType>([^<]*)<\/ServiceType>/g)].map((x) => x[1]);
    if (!types.includes("Flat")) continue;
    const max = Number(tag(b, "ShippingTimeMax"));
    out.push({ code, category: tag(b, "ShippingCategory") ?? "", carrier: tag(b, "ShippingCarrier"), maxDays: Number.isFinite(max) && max > 0 ? max : null });
  }
  return out;
}

/** Service choisi : livraison standard (sinon économique, sinon express), générique plutôt que lié à un transporteur, la plus rapide. */
export function pickShippingService(list: ShippingServiceOption[]): string | null {
  const rank = (c: string) => ({ STANDARD: 0, ECONOMY: 1, EXPEDITED: 2 } as Record<string, number>)[c] ?? 9;
  const best = list
    .filter((s) => rank(s.category) < 9)
    .sort((a, b) => rank(a.category) - rank(b.category) || Number(!!a.carrier) - Number(!!b.carrier) || (a.maxDays ?? 99) - (b.maxDays ?? 99) || a.code.localeCompare(b.code))[0];
  return best?.code ?? null;
}

export const DEFAULT_POLICY_NAMES = { fulfillment: "Sellvela - Free shipping", payment: "Sellvela - Payment", returns: "Sellvela - 30-day returns" } as const;
export const DEFAULT_HANDLING_DAYS = 3;

/** Crée les politiques standard manquantes : livraison gratuite (préparation 3 jours), paiement immédiat, retours 30 jours. */
export async function createDefaultPolicies(
  token: string,
  marketId: MarketplaceId,
  missing: { fulfillment: boolean; payment: boolean; returns: boolean },
): Promise<void> {
  const m = marketplace(marketId);
  const base = { marketplaceId: marketId, categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }] };
  if (missing.fulfillment) {
    const code = pickShippingService(parseShippingServices(await trading(token, "GeteBayDetails", "<DetailName>ShippingServiceDetails</DetailName>", marketId)));
    if (!code) throw new EbayApiError("/sell/account/v1/fulfillment_policy", 400, "NO_SHIPPING_SERVICE");
    await api<unknown>(token, "/sell/account/v1/fulfillment_policy", {
      method: "POST",
      body: JSON.stringify({
        ...base,
        name: DEFAULT_POLICY_NAMES.fulfillment,
        handlingTime: { value: DEFAULT_HANDLING_DAYS, unit: "DAY" },
        shippingOptions: [{
          optionType: "DOMESTIC",
          costType: "FLAT_RATE",
          shippingServices: [{ shippingServiceCode: code, freeShipping: true, sortOrder: 1, shippingCost: { value: "0.00", currency: m.currency } }],
        }],
      }),
    }, marketId);
  }
  if (missing.payment) {
    await api<unknown>(token, "/sell/account/v1/payment_policy", {
      method: "POST",
      body: JSON.stringify({ ...base, name: DEFAULT_POLICY_NAMES.payment, immediatePay: true }),
    }, marketId);
  }
  if (missing.returns) {
    await api<unknown>(token, "/sell/account/v1/return_policy", {
      method: "POST",
      body: JSON.stringify({
        ...base,
        name: DEFAULT_POLICY_NAMES.returns,
        returnsAccepted: true,
        returnPeriod: { value: 30, unit: "DAY" },
        returnShippingCostPayer: "BUYER",
        refundMethod: "MONEY_BACK",
      }),
    }, marketId);
  }
}

/** Clé publique d'eBay pour vérifier la signature d'une notification (API Notification). */
export async function getNotificationPublicKey(kid: string): Promise<{ algorithm: string; digest: string; key: string }> {
  return api(await getAppToken(), `/commerce/notification/v1/public_key/${encodeURIComponent(kid)}`);
}

export interface ShipFrom { postalCode: string; city?: string; stateOrProvince?: string; country: string }

/** Crée le lieu d'expédition (entrepôt) s'il n'existe pas encore. La clé ne peut plus changer ensuite. */
export async function ensureLocation(token: string, key: string, a: ShipFrom): Promise<void> {
  try {
    await api<unknown>(token, `/sell/inventory/v1/location/${encodeURIComponent(key)}`);
    return;
  } catch (e) {
    if (!(e instanceof EbayApiError) || e.status !== 404) throw e;
  }
  await api<void>(token, `/sell/inventory/v1/location/${encodeURIComponent(key)}`, {
    method: "POST",
    body: JSON.stringify({
      name: `Warehouse ${a.country} ${a.postalCode}`.slice(0, 1000),
      locationTypes: ["WAREHOUSE"],
      merchantLocationStatus: "ENABLED",
      location: {
        address: {
          postalCode: a.postalCode,
          country: a.country,
          ...(a.city ? { city: a.city } : {}),
          ...(a.stateOrProvince ? { stateOrProvince: a.stateOrProvince } : {}),
        },
      },
    }),
  });
}

/* ---------- Catégories et caractéristiques (API Taxonomy, jeton application) ---------- */

const treeIds = new Map<string, string>();
async function categoryTreeId(marketId: MarketplaceId): Promise<string> {
  const cached = treeIds.get(marketId);
  if (cached) return cached;
  const d = await api<{ categoryTreeId: string }>(await getAppToken(), `/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${marketId}`, {}, marketId);
  treeIds.set(marketId, d.categoryTreeId);
  return d.categoryTreeId;
}

export async function suggestCategory(q: string, marketId: MarketplaceId): Promise<{ id: string; name: string } | null> {
  const tree = await categoryTreeId(marketId);
  const d = await api<{ categorySuggestions?: { category: { categoryId: string; categoryName: string } }[] }>(
    await getAppToken(),
    `/commerce/taxonomy/v1/category_tree/${tree}/get_category_suggestions?${new URLSearchParams({ q })}`,
    {},
    marketId,
  );
  const c = d.categorySuggestions?.[0]?.category;
  return c ? { id: c.categoryId, name: c.categoryName } : null;
}

export interface AspectDef {
  name: string;
  required: boolean;
  mode: "FREE_TEXT" | "SELECTION_ONLY";
  multi: boolean;
  maxLength?: number;
  values: string[]; // valeurs proposées par eBay (obligatoires si SELECTION_ONLY)
}

export async function getAspects(categoryId: string, marketId: MarketplaceId): Promise<AspectDef[]> {
  const tree = await categoryTreeId(marketId);
  const d = await api<{
    aspects?: {
      localizedAspectName: string;
      aspectConstraint?: { aspectRequired?: boolean; aspectMode?: string; itemToAspectCardinality?: string; aspectMaxLength?: number; aspectUsage?: string };
      aspectValues?: { localizedValue: string }[];
    }[];
  }>(await getAppToken(), `/commerce/taxonomy/v1/category_tree/${tree}/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`, {}, marketId);
  return (d.aspects ?? []).map((a) => ({
    name: a.localizedAspectName,
    required: a.aspectConstraint?.aspectRequired === true,
    mode: a.aspectConstraint?.aspectMode === "SELECTION_ONLY" ? "SELECTION_ONLY" : "FREE_TEXT",
    multi: a.aspectConstraint?.itemToAspectCardinality === "MULTI",
    maxLength: a.aspectConstraint?.aspectMaxLength,
    values: (a.aspectValues ?? []).map((v) => v.localizedValue),
  }));
}

/** Nom lisible d'une catégorie (chemin court). */
export async function categoryName(categoryId: string, marketId: MarketplaceId): Promise<string | null> {
  try {
    const tree = await categoryTreeId(marketId);
    const d = await api<{ categorySubtreeNode?: { category?: { categoryName: string } } }>(
      await getAppToken(),
      `/commerce/taxonomy/v1/category_tree/${tree}/get_category_subtree?category_id=${encodeURIComponent(categoryId)}`,
      {},
      marketId,
    );
    return d.categorySubtreeNode?.category?.categoryName ?? null;
  } catch {
    return null;
  }
}

/** Retire l'annonce (rupture ou marge sous le seuil). */
export function withdrawOffer(token: string, offerId: string, marketId: MarketplaceId = "EBAY_US") {
  return api<{ listingId: string }>(token, `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/withdraw`, { method: "POST" }, marketId);
}

/* ---------- Commandes (API Fulfillment) ---------- */

export interface EbayAddress {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  stateOrProvince?: string;
  postalCode?: string;
  countryCode: string;
}

export interface EbayOrder {
  orderId: string;
  creationDate: string;
  orderFulfillmentStatus: string;            // NOT_STARTED | IN_PROGRESS | FULFILLED
  orderPaymentStatus?: string;               // PAID | PENDING | FAILED | FULLY_REFUNDED | PARTIALLY_REFUNDED
  cancelStatus?: { cancelState?: string };   // NONE_REQUESTED si aucune annulation
  pricingSummary: { total: { value: string; currency?: string } };
  lineItems: { lineItemId: string; legacyItemId?: string; sku?: string; quantity: number; title: string; lineItemFulfillmentStatus?: string }[];
  buyer?: { username?: string };
  fulfillmentStartInstructions: {
    shippingStep?: {
      shipTo: {
        fullName: string;
        email?: string;
        primaryPhone?: { phoneNumber: string };
        contactAddress: EbayAddress;
      };
    };
  }[];
}

/** Commandes à expédier créées depuis `since` (toutes les pages, 200 au maximum). */
export async function getOrdersToShip(token: string, since: Date): Promise<EbayOrder[]> {
  const out: EbayOrder[] = [];
  for (let offset = 0; offset < 200; offset += 50) {
    const q = new URLSearchParams({
      filter: `creationdate:[${since.toISOString()}..],orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}`,
      limit: "50",
      offset: String(offset),
    });
    const data = await api<{ orders?: EbayOrder[]; total?: number }>(token, `/sell/fulfillment/v1/order?${q}`);
    out.push(...(data.orders ?? []));
    if (!data.orders?.length || out.length >= (data.total ?? 0)) break;
  }
  return out;
}

export function getOrder(token: string, orderId: string) {
  return api<EbayOrder>(token, `/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}`);
}

/** Renvoie le numéro de suivi à eBay (la commande passe « expédiée » pour l'acheteur). */
export function addTracking(
  token: string,
  orderId: string,
  lineItems: { lineItemId: string; quantity: number }[],
  carrierCode: string,
  trackingNumber: string,
) {
  return api<void>(token, `/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}/shipping_fulfillment`, {
    method: "POST",
    body: JSON.stringify({
      lineItems,
      shippedDate: new Date().toISOString(),
      shippingCarrierCode: carrierCode,
      trackingNumber,
    }),
  });
}

/* ---------- API Trading (XML) : messages aux acheteurs ---------- */

/** Numéro de site eBay (API Trading) par pays. */
export const SITE_IDS: Record<MarketplaceId, string> = {
  EBAY_US: "0", EBAY_CA: "2", EBAY_GB: "3", EBAY_AU: "15", EBAY_DE: "77", EBAY_FR: "71", EBAY_IT: "101", EBAY_ES: "186", EBAY_IE: "205",
};

const xmlEscape = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);

export class TradingError extends Error {
  constructor(readonly call: string, readonly detail: string) {
    super(`eBay ${call} : ${detail}`);
  }
}

async function trading(token: string, call: string, inner: string, marketId: MarketplaceId): Promise<string> {
  const res = await fetch(`${host().api}/ws/api.dll`, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": call,
      "X-EBAY-API-SITEID": SITE_IDS[marketId] ?? "0",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1349",
      "X-EBAY-API-IAF-TOKEN": token,
    },
    body: `<?xml version="1.0" encoding="utf-8"?><${call}Request xmlns="urn:ebay:apis:eBLBaseComponents">${inner}</${call}Request>`,
  });
  const text = await res.text();
  if (!res.ok || !/<Ack>(Success|Warning)<\/Ack>/.test(text)) {
    const msg = [...text.matchAll(/<LongMessage>([\s\S]*?)<\/LongMessage>/g)].map((m) => m[1]).join(" · ") || `HTTP ${res.status}`;
    throw new TradingError(call, msg);
  }
  return text;
}

/** Message à l'acheteur d'une commande (API Trading AddMemberMessageAAQToPartner). */
export async function sendBuyerMessage(
  token: string,
  m: { itemId: string; buyer: string; subject: string; body: string },
  marketId: MarketplaceId = "EBAY_US",
): Promise<void> {
  await trading(
    token,
    "AddMemberMessageAAQToPartner",
    `<ItemID>${xmlEscape(m.itemId)}</ItemID><MemberMessage><Subject>${xmlEscape(m.subject.slice(0, 100))}</Subject><Body>${xmlEscape(m.body.slice(0, 2000))}</Body><QuestionType>General</QuestionType><RecipientID>${xmlEscape(m.buyer)}</RecipientID></MemberMessage>`,
    marketId,
  );
}

/* ---------- Annonces créées en dehors de l'outil (API Trading) ---------- */

export interface ActiveItem {
  itemId: string;
  title: string;
  sku: string | null;
  price: number;
  currency: string;
  quantity: number; // quantité disponible
  image: string | null;
  url: string | null;
  startedAt: string | null;
  hasVariations: boolean;
  fixedPrice: boolean; // false : enchère (non gérée)
}

const xmlDecode = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");

/** Premier contenu d'une balise (sans ses attributs) dans un fragment XML. */
function xtag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? xmlDecode(m[1].trim()) : null;
}

/** Annonces actives d'une page GetMyeBaySelling (bloc ActiveList uniquement). */
export function parseActiveList(xml: string): { items: ActiveItem[]; totalPages: number } {
  const block = xml.match(/<ActiveList>([\s\S]*?)<\/ActiveList>/)?.[1] ?? "";
  const totalPages = Number(xtag(block.match(/<PaginationResult>[\s\S]*?<\/PaginationResult>/)?.[0] ?? "", "TotalNumberOfPages") ?? 1) || 1;
  const items: ActiveItem[] = [];
  for (const m of block.matchAll(/<Item>([\s\S]*?)<\/Item>/g)) {
    const x = m[1];
    const itemId = xtag(x, "ItemID");
    const title = xtag(x, "Title");
    const priceTag = x.match(/<CurrentPrice currencyID="([A-Z]{3})">([\d.]+)<\/CurrentPrice>/) ?? x.match(/<BuyItNowPrice currencyID="([A-Z]{3})">([\d.]+)<\/BuyItNowPrice>/);
    if (!itemId || !title || !priceTag) continue;
    const listingType = xtag(x, "ListingType");
    items.push({
      itemId,
      title,
      sku: xtag(x.replace(/<Variations>[\s\S]*?<\/Variations>/, ""), "SKU"),
      price: Number(priceTag[2]),
      currency: priceTag[1],
      quantity: Math.max(0, Number(xtag(x, "QuantityAvailable") ?? xtag(x, "Quantity") ?? 0) || 0),
      image: xtag(x, "GalleryURL"),
      url: xtag(x, "ViewItemURL"),
      startedAt: xtag(x, "StartTime"),
      hasVariations: /<Variations>/.test(x),
      fixedPrice: !listingType || listingType === "FixedPriceItem" || listingType === "StoresFixedPrice",
    });
  }
  return { items, totalPages };
}

/** Toutes les annonces actives du compte (200 par page, 25 pages au plus). */
export async function getActiveListings(token: string): Promise<ActiveItem[]> {
  const all: ActiveItem[] = [];
  for (let page = 1; page <= 25; page++) {
    const xml = await trading(
      token,
      "GetMyeBaySelling",
      `<ActiveList><Include>true</Include><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination></ActiveList>` +
        "<SoldList><Include>false</Include></SoldList><UnsoldList><Include>false</Include></UnsoldList><ScheduledList><Include>false</Include></ScheduledList>" +
        "<DeletedFromSoldList><Include>false</Include></DeletedFromSoldList><DeletedFromUnsoldList><Include>false</Include></DeletedFromUnsoldList>",
      "EBAY_US",
    );
    const { items, totalPages } = parseActiveList(xml);
    all.push(...items);
    if (page >= totalPages) break;
  }
  return all;
}

/** Quantité (et prix) d'une annonce créée hors de l'outil (API Trading ReviseInventoryStatus). */
export async function reviseInventoryStatus(token: string, u: { itemId: string; quantity: number; price?: number }, marketId: MarketplaceId): Promise<void> {
  await trading(
    token,
    "ReviseInventoryStatus",
    `<InventoryStatus><ItemID>${xmlEscape(u.itemId)}</ItemID><Quantity>${Math.max(0, Math.floor(u.quantity))}</Quantity>${u.price !== undefined ? `<StartPrice>${u.price.toFixed(2)}</StartPrice>` : ""}</InventoryStatus>`,
    marketId,
  );
}

/* ---------- Retours et annulations (API Post-Order v2) ---------- */

async function postOrder<T>(token: string, path: string, init: RequestInit = {}, marketId: MarketplaceId = "EBAY_US"): Promise<T> {
  const res = await fetch(`${host().api}/post-order/v2${path}`, {
    ...init,
    headers: {
      Authorization: `IAF ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Language": marketplace(marketId).language,
      "X-EBAY-C-MARKETPLACE-ID": marketplace(marketId).id,
      ...init.headers,
    },
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!res.ok) throw new EbayApiError(`/post-order/v2${path}`, res.status, text);
  return (text ? JSON.parse(text) : undefined) as T;
}

type Money = { value?: number | string; currency?: string };

export interface EbayReturn {
  returnId: string;
  orderId: string;
  state: string;
  status?: string;
  creationInfo?: {
    reason?: string;
    comments?: { content?: string };
    creationDate?: { value?: string };
    item?: { itemId?: string; itemTitle?: string };
  };
  buyerTotalRefund?: { estimatedRefundAmount?: Money };
}

export interface EbayCancellation {
  cancelId: string;
  legacyOrderId: string;
  cancelState: string;   // CANCEL_REQUESTED, CANCEL_CLOSED…
  cancelStatus?: string;
  cancelReason?: string;
  requestRefundAmount?: Money;
  cancelRequestDate?: { value?: string };
}

/** Retours en cours (ouverts). */
export async function searchReturns(token: string, marketId: MarketplaceId = "EBAY_US"): Promise<EbayReturn[]> {
  const d = await postOrder<{ members?: EbayReturn[] }>(token, `/return/search?${new URLSearchParams({ return_state: "ALL_OPEN", limit: "100" })}`, {}, marketId);
  return d.members ?? [];
}

/** Demandes d'annulation des 30 derniers jours. */
export async function searchCancellations(token: string, marketId: MarketplaceId = "EBAY_US"): Promise<EbayCancellation[]> {
  // eBay exige les deux bornes de la période.
  const now = Date.now();
  const from = new Date(now - 30 * 86_400_000).toISOString();
  const to = new Date(now).toISOString();
  const d = await postOrder<{ cancellations?: EbayCancellation[] }>(token, `/cancellation/search?${new URLSearchParams({ creation_date_range_from: from, creation_date_range_to: to, limit: "100" })}`, {}, marketId);
  return d.cancellations ?? [];
}

/** Accepte la demande d'annulation de l'acheteur (il est remboursé par eBay). */
export function approveCancellation(token: string, cancelId: string, marketId: MarketplaceId = "EBAY_US") {
  return postOrder<void>(token, `/cancellation/${encodeURIComponent(cancelId)}/approve`, { method: "POST", body: "{}" }, marketId);
}

/** Accepte le retour (l'acheteur renvoie l'article ; remboursement à réception). */
export function acceptReturn(token: string, returnId: string, marketId: MarketplaceId = "EBAY_US") {
  return postOrder<void>(token, `/return/${encodeURIComponent(returnId)}/decide`, { method: "POST", body: JSON.stringify({ decision: "ACCEPT" }) }, marketId);
}

/* ---------- Publicité (API Marketing : Promoted Listings, coût par vente) ---------- */

/** Crée (ou retrouve) la campagne « coût par vente » de l'outil pour un pays. Renvoie son identifiant. */
export async function ensureCampaign(token: string, marketId: MarketplaceId, name: string): Promise<string> {
  const m = marketplace(marketId);
  const found = await api<{ campaigns?: { campaignId: string; campaignStatus?: string }[] }>(
    token,
    `/sell/marketing/v1/ad_campaign?${new URLSearchParams({ campaign_name: name, limit: "10" })}`,
    {},
    m.id,
  ).catch(() => ({ campaigns: [] as { campaignId: string; campaignStatus?: string }[] }));
  const live = found.campaigns?.find((c) => c.campaignStatus !== "ENDED");
  if (live) return live.campaignId;
  const res = await fetch(`${host().api}/sell/marketing/v1/ad_campaign`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Accept-Language": m.language, "X-EBAY-C-MARKETPLACE-ID": m.id },
    body: JSON.stringify({
      campaignName: name,
      marketplaceId: m.id,
      startDate: new Date(Date.now() + 60_000).toISOString(),
      fundingStrategy: { fundingModel: "COST_PER_SALE", bidPercentage: "2.0" },
    }),
  });
  if (!res.ok) throw new EbayApiError("/sell/marketing/v1/ad_campaign", res.status, await res.text());
  const id = res.headers.get("location")?.split("/").pop();
  if (!id) throw new EbayApiError("/sell/marketing/v1/ad_campaign", 500, "Identifiant de campagne absent");
  return id;
}

/** Ajoute des annonces à la campagne avec leur taux (%). */
export async function createAds(
  token: string,
  campaignId: string,
  ads: { listingId: string; rate: number }[],
  marketId: MarketplaceId,
): Promise<{ listingId: string; adId?: string; ok: boolean; message?: string }[]> {
  const d = await api<{ responses?: { listingId?: string; adId?: string; statusCode?: number; errors?: EbayErrorDetail[] }[] }>(
    token,
    `/sell/marketing/v1/ad_campaign/${encodeURIComponent(campaignId)}/bulk_create_ads_by_listing_id`,
    { method: "POST", body: JSON.stringify({ requests: ads.map((a) => ({ listingId: a.listingId, bidPercentage: a.rate.toFixed(1) })) }) },
    marketId,
  );
  return ads.map((a) => {
    const r = d.responses?.find((x) => x.listingId === a.listingId);
    const ok = Boolean(r && (r.statusCode ?? 200) < 400 && r.adId);
    return { listingId: a.listingId, adId: r?.adId, ok, message: ok ? undefined : r?.errors?.map((e) => e.longMessage || e.message).join(" · ") };
  });
}

export function updateAdRate(token: string, campaignId: string, adId: string, rate: number, marketId: MarketplaceId) {
  return api<void>(
    token,
    `/sell/marketing/v1/ad_campaign/${encodeURIComponent(campaignId)}/ad/${encodeURIComponent(adId)}/update_bid`,
    { method: "POST", body: JSON.stringify({ bidPercentage: rate.toFixed(1) }) },
    marketId,
  );
}

export function deleteAd(token: string, campaignId: string, adId: string, marketId: MarketplaceId) {
  return api<void>(token, `/sell/marketing/v1/ad_campaign/${encodeURIComponent(campaignId)}/ad/${encodeURIComponent(adId)}`, { method: "DELETE" }, marketId);
}
