/**
 * Client eBay (API REST officielles) — marketplace EBAY_US.
 * OAuth « authorization code » pour le compte vendeur du client,
 * jeton « application » (client credentials) pour l'API Browse.
 */
import { env } from "@/lib/env";

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

async function api<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${host().api}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Language": "en-US",
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      ...init.headers,
    },
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!res.ok) throw new Error(`eBay ${path} ${res.status} : ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

/* ---------- Recherche (API Browse) : prix des annonces actives neuves aux US ---------- */

interface ItemSummary {
  itemId: string;
  title: string;
  price?: { value: string; currency: string };
  shippingOptions?: { shippingCost?: { value: string } }[];
  itemWebUrl?: string;
  image?: { imageUrl: string };
}

export interface MarketSnapshot {
  total: number;
  prices: number[]; // prix total acheteur (produit + livraison)
  items: { id: string; title: string; price: number; url?: string; image?: string }[];
}

export async function searchActive(q: string, limit = 50): Promise<MarketSnapshot> {
  const token = await getAppToken();
  const params = new URLSearchParams({
    q,
    limit: String(limit),
    filter: "buyingOptions:{FIXED_PRICE},conditions:{NEW},itemLocationCountry:US,priceCurrency:USD",
  });
  const data = await api<{ total: number; itemSummaries?: ItemSummary[] }>(token, `/buy/browse/v1/item_summary/search?${params}`);
  const items = (data.itemSummaries ?? []).map((i) => {
    const ship = Number(i.shippingOptions?.[0]?.shippingCost?.value ?? 0);
    return { id: i.itemId, title: i.title, price: Number(i.price?.value ?? 0) + ship, url: i.itemWebUrl, image: i.image?.imageUrl };
  });
  return { total: data.total, prices: items.map((i) => i.price).filter((p) => p > 0), items };
}

/**
 * Ventes estimées d'une annonce (API Browse getItem → estimatedAvailabilities.estimatedSoldQuantity).
 * Source officielle et gratuite ; c'est une estimation d'eBay, cumulée sur la vie de l'annonce.
 */
export async function getSoldQuantity(itemId: string): Promise<number> {
  const token = await getAppToken();
  const data = await api<{ estimatedAvailabilities?: { estimatedSoldQuantity?: number }[] }>(
    token,
    `/buy/browse/v1/item/${encodeURIComponent(itemId)}`,
  );
  return data.estimatedAvailabilities?.reduce((s, a) => s + (a.estimatedSoldQuantity ?? 0), 0) ?? 0;
}

export interface DemandSnapshot extends MarketSnapshot {
  unitsSold: number;                                  // total estimé sur les annonces analysées
  soldWeighted: { price: number; weight: number }[]; // prix × unités vendues
}

/** Marché + demande : prix des annonces actives, pondérés par ce qu'elles ont réellement vendu. */
export async function searchWithDemand(q: string, sample = 20): Promise<DemandSnapshot> {
  const market = await searchActive(q, 50);
  const soldWeighted: { price: number; weight: number }[] = [];
  for (const item of market.items.slice(0, sample)) {
    try {
      soldWeighted.push({ price: item.price, weight: await getSoldQuantity(item.id) });
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

export function putInventoryItem(token: string, sku: string, i: InventoryItemInput) {
  return api<void>(token, `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
    method: "PUT",
    body: JSON.stringify({
      condition: "NEW",
      product: { title: i.title.slice(0, 80), description: i.description, imageUrls: i.imageUrls, aspects: i.aspects },
      availability: { shipToLocationAvailability: { quantity: i.quantity } },
    }),
  });
}

export interface OfferInput {
  sku: string;
  categoryId: string;
  priceUsd: number;
  quantity: number;
  description: string;
  merchantLocationKey: string;
  fulfillmentPolicyId: string;
  paymentPolicyId: string;
  returnPolicyId: string;
}

export function createOffer(token: string, o: OfferInput) {
  return api<{ offerId: string }>(token, "/sell/inventory/v1/offer", {
    method: "POST",
    body: JSON.stringify({
      sku: o.sku,
      marketplaceId: "EBAY_US",
      format: "FIXED_PRICE",
      availableQuantity: o.quantity,
      categoryId: o.categoryId,
      listingDescription: o.description,
      merchantLocationKey: o.merchantLocationKey,
      pricingSummary: { price: { value: o.priceUsd.toFixed(2), currency: "USD" } },
      listingPolicies: {
        fulfillmentPolicyId: o.fulfillmentPolicyId,
        paymentPolicyId: o.paymentPolicyId,
        returnPolicyId: o.returnPolicyId,
      },
    }),
  });
}

export function publishOffer(token: string, offerId: string) {
  return api<{ listingId: string }>(token, `/sell/inventory/v1/offer/${offerId}/publish`, { method: "POST" });
}

/** Retire l'annonce (rupture ou marge sous le seuil). */
export function withdrawOffer(token: string, offerId: string) {
  return api<{ listingId: string }>(token, `/sell/inventory/v1/offer/${offerId}/withdraw`, { method: "POST" });
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
