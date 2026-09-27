/**
 * Client eBay (API REST officielles) — EBAY_US par défaut, EBAY_CA / EBAY_GB / EBAY_AU via `marketId`.
 * OAuth « authorization code » pour le compte vendeur du client,
 * jeton « application » (client credentials) pour l'API Browse.
 */
import { env } from "@/lib/env";
import { marketplace, type MarketplaceId } from "@/lib/marketplaces";

const HOSTS = {
  sandbox: { auth: "https://auth.sandbox.ebay.com", api: "https://api.sandbox.ebay.com" },
  production: { auth: "https://auth.ebay.com", api: "https://api.ebay.com" },
} as const;

const host = () => HOSTS[env().EBAY_ENV];

export const SELLER_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/sell.account",
];

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

export function refreshUserToken(refreshToken: string) {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken, scope: SELLER_SCOPES.join(" ") });
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

/* ---------- Recherche (API Browse) : prix des annonces actives neuves dans le pays ---------- */

interface ItemSummary {
  itemId: string;
  title: string;
  price?: { value: string; currency: string };
  shippingOptions?: { shippingCost?: { value: string } }[];
  itemWebUrl?: string;
  image?: { imageUrl: string };
  leafCategoryIds?: string[];
}

export interface MarketSnapshot {
  total: number;
  prices: number[]; // prix total acheteur (produit + livraison)
  items: { id: string; title: string; price: number; url?: string; image?: string; categoryId?: string }[];
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
    };
  });
  return { total: data.total, prices: items.map((i) => i.price).filter((p) => p > 0), items };
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

export interface DemandSnapshot extends MarketSnapshot {
  unitsSold: number;                                  // total estimé sur les annonces analysées
  soldWeighted: { price: number; weight: number }[]; // prix × unités vendues
}

/** Marché + demande : prix des annonces actives, pondérés par ce qu'elles ont réellement vendu. */
export async function searchWithDemand(q: string, sample = 20, marketId: MarketplaceId = "EBAY_US"): Promise<DemandSnapshot> {
  const market = await searchActive(q, 50, marketId);
  const soldWeighted: { price: number; weight: number }[] = [];
  for (const item of market.items.slice(0, sample)) {
    try {
      soldWeighted.push({ price: item.price, weight: await getSoldQuantity(item.id, marketId) });
    } catch {
      /* annonce retirée entre-temps : on l'ignore */
    }
  }
  return { ...market, soldWeighted, unitsSold: soldWeighted.reduce((s, p) => s + p.weight, 0) };
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

export interface EbayOrder {
  orderId: string;
  creationDate: string;
  orderFulfillmentStatus: string;
  pricingSummary: { total: { value: string } };
  lineItems: { lineItemId: string; sku?: string; quantity: number; title: string }[];
  fulfillmentStartInstructions: {
    shippingStep?: {
      shipTo: {
        fullName: string;
        primaryPhone?: { phoneNumber: string };
        contactAddress: {
          addressLine1: string;
          addressLine2?: string;
          city: string;
          stateOrProvince: string;
          postalCode: string;
          countryCode: string;
        };
      };
    };
  }[];
}

export async function getOpenOrders(token: string): Promise<EbayOrder[]> {
  const q = new URLSearchParams({ filter: "orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}", limit: "50" });
  const data = await api<{ orders?: EbayOrder[] }>(token, `/sell/fulfillment/v1/order?${q}`);
  return data.orders ?? [];
}

/** Renvoie le numéro de suivi à eBay. */
export function addTracking(
  token: string,
  orderId: string,
  lineItems: { lineItemId: string; quantity: number }[],
  carrierCode: string,
  trackingNumber: string,
) {
  return api<void>(token, `/sell/fulfillment/v1/order/${orderId}/shipping_fulfillment`, {
    method: "POST",
    body: JSON.stringify({
      lineItems,
      shippedDate: new Date().toISOString(),
      shippingCarrierCode: carrierCode,
      trackingNumber,
    }),
  });
}
