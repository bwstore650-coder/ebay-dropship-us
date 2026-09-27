/**
 * Client CJDropshipping — API 2.0
 * Doc : https://developers.cjdropshipping.com/en/api/api2/
 * Limite : 1 appel par seconde (QPS = 1). Jeton valable 180 jours.
 */
import type { SupplierOffer } from "@/lib/margin";

const BASE = "https://developers.cjdropshipping.com/api2.0/v1";

interface CjResponse<T> {
  code: number;
  result: boolean;
  message: string;
  data: T;
}

let lastCall = 0;
async function throttle() {
  const wait = lastCall + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

async function cjFetch<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  await throttle();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.token ? { "CJ-Access-Token": init.token } : {}),
      ...init.headers,
    },
  });
  const json = (await res.json()) as CjResponse<T>;
  if (!res.ok || !json.result) throw new Error(`CJ ${path} : ${json.message ?? res.status}`);
  return json.data;
}

export interface CjTokens {
  accessToken: string;
  accessTokenExpiryDate: string;
  refreshToken: string;
  refreshTokenExpiryDate: string;
}

/** La clé API se trouve dans le tableau de bord CJ : Apps > API. */
export function getAccessToken(apiKey: string) {
  return cjFetch<CjTokens>("/authentication/getAccessToken", {
    method: "POST",
    body: JSON.stringify({ apiKey }),
  });
}

export function refreshAccessToken(refreshToken: string) {
  return cjFetch<CjTokens>("/authentication/refreshAccessToken", {
    method: "POST",
    body: JSON.stringify({ refreshToken }),
  });
}

/** Recherche de produits en entrepôt US. */
export function searchProducts(token: string, keyWord: string, page = 1, size = 20) {
  const q = new URLSearchParams({ keyWord, countryCode: "US", page: String(page), size: String(size) });
  return cjFetch<unknown>(`/product/listV2?${q}`, { token });
}

export interface CjVariant {
  vid: string;
  variantSku: string;
  variantKey?: string;
  variantSellPrice: number;
  inventories?: { countryCode: string; totalInventory: number }[];
}

export interface CjProduct {
  pid: string;
  productNameEn: string;
  productImage?: string;
  sellPrice: number | string;
  variants: CjVariant[];
}

export function getProduct(token: string, pid: string) {
  return cjFetch<CjProduct>(`/product/query?${new URLSearchParams({ pid })}`, { token });
}

export interface CjFreightOption {
  logisticName: string;
  logisticPrice: number;
  logisticAging: string; // ex. "3-8"
}

export function freightCalculate(token: string, vid: string, quantity = 1, startCountryCode = "US") {
  return cjFetch<CjFreightOption[]>("/logistic/freightCalculate", {
    method: "POST",
    token,
    body: JSON.stringify({ startCountryCode, endCountryCode: "US", products: [{ vid, quantity }] }),
  });
}

/** Transforme un produit CJ en offres comparables (une par variante), avec la livraison la moins chère. */
export async function toOffers(token: string, product: CjProduct): Promise<SupplierOffer[]> {
  const offers: SupplierOffer[] = [];
  for (const v of product.variants) {
    const stockUs = v.inventories?.find((i) => i.countryCode === "US")?.totalInventory ?? 0;
    if (stockUs <= 0) continue;
    const options = await freightCalculate(token, v.vid);
    if (!options.length) continue;
    const cheapest = options.reduce((a, b) => (b.logisticPrice < a.logisticPrice ? b : a));
    offers.push({
      supplier: "CJ",
      productId: product.pid,
      variantId: v.vid,
      title: `${product.productNameEn}${v.variantKey ? ` — ${v.variantKey}` : ""}`,
      price: Number(v.variantSellPrice),
      shipping: Number(cheapest.logisticPrice),
      stockUs,
      deliveryDaysMax: parseMaxDays(cheapest.logisticAging),
    });
  }
  return offers;
}

export interface CjOrderInput {
  orderNumber: string; // notre identifiant unique (ex. id de la commande eBay)
  logisticName: string;
  shippingCustomerName: string;
  shippingAddress: string;
  shippingAddress2?: string;
  shippingCity: string;
  shippingProvince: string;
  shippingZip: string;
  shippingPhone?: string;
  products: { vid: string; quantity: number }[];
}

/** Crée la commande chez CJ, payée avec le solde du compte CJ du client (payType 2). */
export function createOrder(token: string, o: CjOrderInput) {
  return cjFetch<{ orderId: string }>("/shopping/order/createOrderV2", {
    method: "POST",
    token,
    body: JSON.stringify({
      ...o,
      shippingCountryCode: "US",
      shippingCountry: "United States",
      fromCountryCode: "US",
      payType: 2,
    }),
  });
}

export function trackInfo(token: string, trackNumber: string) {
  return cjFetch<unknown>(`/logistic/trackInfo?${new URLSearchParams({ trackNumber })}`, { token });
}

export function parseMaxDays(aging: string | undefined): number {
  const nums = (aging ?? "").match(/\d+/g)?.map(Number) ?? [];
  return nums.length ? Math.max(...nums) : 99;
}
