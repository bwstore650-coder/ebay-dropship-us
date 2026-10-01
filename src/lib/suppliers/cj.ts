/**
 * Client CJDropshipping — API 2.0
 * Doc : https://developers.cjdropshipping.com/en/api/api2/
 * Limite : 1 appel par seconde (QPS = 1). Jeton valable 180 jours.
 */
import type { SupplierOffer } from "@/lib/margin";

const BASE = "https://developers.cjdropshipping.com/api2.0/v1";

interface CjResponse<T> {
  code: number;
  result?: boolean;
  success?: boolean; // certains points d'accès (stock) répondent « success » au lieu de « result »
  message: string;
  data: T;
}

/** Limite de CJ : 1 appel par seconde et par compte. Chaque compte (jeton) a son propre rythme. */
const lastCalls = new Map<string, number>();
async function throttle(key: string) {
  const now = Date.now();
  const next = Math.max(now, (lastCalls.get(key) ?? 0) + 1100);
  lastCalls.set(key, next); // réservé avant d'attendre : deux appels simultanés ne partent pas ensemble
  if (next > now) await new Promise((r) => setTimeout(r, next - now));
}

/** Réponse « trop de requêtes » : un autre traitement utilise le même compte CJ au même moment. */
const isRateLimited = (status: number, message: string | undefined) => status === 429 || /too many requests|qps limit/i.test(message ?? "");
export const CJ_RATE_RETRIES = 3;

async function cjFetch<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    await throttle(init.token ?? "public");
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.token ? { "CJ-Access-Token": init.token } : {}),
        ...init.headers,
      },
    });
    const json = (await res.json().catch(() => ({}))) as Partial<CjResponse<T>>;
    if (res.ok && (json.result ?? json.success)) return json.data as T;
    // Limite d'un appel par seconde atteinte : on patiente un peu plus à chaque essai.
    if (attempt < CJ_RATE_RETRIES && isRateLimited(res.status, json.message)) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    throw new Error(`CJ ${path} : ${json.message ?? res.status}`);
  }
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

/** Recherche de produits dans l'entrepôt du pays (US, CA, GB, AU). */
export function searchProducts(token: string, keyWord: string, page = 1, size = 20, countryCode = "US") {
  const q = new URLSearchParams({ keyWord, countryCode, page: String(page), size: String(size) });
  return cjFetch<unknown>(`/product/listV2?${q}`, { token });
}

export interface CjVariant {
  vid: string;
  variantSku: string;
  variantKey?: string;
  variantNameEn?: string;
  variantImage?: string;
  variantSellPrice: number;
  inventories?: { countryCode: string; totalInventory: number }[];
}

export interface CjProduct {
  pid: string;
  productNameEn: string;
  productImage?: string;          // une URL, ou une liste JSON d'URL selon les produits
  productImageSet?: string[] | string;
  description?: string;           // HTML
  materialNameEn?: string;
  packingNameEn?: string;
  productWeight?: number | string;
  sellPrice: number | string;
  variants: CjVariant[];
}

/** Toutes les URL d'images d'un produit CJ (les champs varient d'un produit à l'autre). */
export function productImages(p: CjProduct, v?: CjVariant): string[] {
  const out: string[] = [];
  const add = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(add);
    else if (typeof x === "string") {
      const t = x.trim();
      if (t.startsWith("[")) {
        try {
          add(JSON.parse(t));
          return;
        } catch {
          /* pas du JSON */
        }
      }
      t.split(/[,;\s]+(?=https?:)/).forEach((u) => /^https?:\/\//.test(u) && out.push(u));
    }
  };
  add(v?.variantImage);
  add(p.productImage);
  add(p.productImageSet);
  return out;
}

interface CjPidInventory {
  variantInventories?: { vid: string; inventory?: { countryCode: string; totalInventory: number }[] }[];
}

/**
 * Fiche produit avec le stock de chaque variante par pays.
 * La fiche CJ ne renvoie plus toujours ce stock (« inventories » vide) : il est alors lu à part, en un appel par produit.
 */
export async function getProduct(token: string, pid: string): Promise<CjProduct> {
  const product = await cjFetch<CjProduct>(`/product/query?${new URLSearchParams({ pid })}`, { token });
  const variants = product.variants ?? [];
  if (!variants.length || variants.every((v) => Array.isArray(v.inventories))) return { ...product, variants };
  const stock = await cjFetch<CjPidInventory>(`/product/stock/getInventoryByPid?${new URLSearchParams({ pid })}`, { token });
  const byVid = new Map((stock.variantInventories ?? []).map((x) => [x.vid, x.inventory ?? []]));
  return {
    ...product,
    variants: variants.map((v) => ({
      ...v,
      inventories: Array.isArray(v.inventories) ? v.inventories : (byVid.get(v.vid) ?? []).map((i) => ({ countryCode: i.countryCode, totalInventory: Number(i.totalInventory) || 0 })),
    })),
  };
}

export interface CjFreightOption {
  logisticName: string;
  logisticPrice: number;
  logisticAging: string; // ex. "3-8"
}

/** Frais de port d'un entrepôt local vers un client du même pays. */
export function freightCalculate(token: string, vid: string, quantity = 1, countryCode = "US") {
  return cjFetch<CjFreightOption[]>("/logistic/freightCalculate", {
    method: "POST",
    token,
    body: JSON.stringify({ startCountryCode: countryCode, endCountryCode: countryCode, products: [{ vid, quantity }] }),
  });
}

/** Transforme un produit CJ en offres comparables (une par variante), avec la livraison la moins chère. */
/** Variantes comparées au plus par produit (les moins chères en stock) : chaque variante coûte un appel CJ (1 par seconde). */
export const MAX_OFFER_VARIANTS = 6;

export async function toOffers(token: string, product: CjProduct, countryCode = "US"): Promise<SupplierOffer[]> {
  const offers: SupplierOffer[] = [];
  const inStock = product.variants
    .map((v) => ({ v, stockUs: v.inventories?.find((i) => i.countryCode === countryCode)?.totalInventory ?? 0 }))
    .filter((x) => x.stockUs > 0)
    .sort((a, b) => Number(a.v.variantSellPrice) - Number(b.v.variantSellPrice))
    .slice(0, MAX_OFFER_VARIANTS);
  for (const { v, stockUs } of inStock) {
    const options = await freightCalculate(token, v.vid, 1, countryCode);
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

const COUNTRY_NAMES: Record<string, string> = {
  US: "United States", CA: "Canada", GB: "United Kingdom", AU: "Australia",
  DE: "Germany", FR: "France", IT: "Italy", ES: "Spain", IE: "Ireland",
};

/** Crée la commande chez CJ (entrepôt local), payée avec le solde du compte CJ du client (payType 2). */
export function createOrder(token: string, o: CjOrderInput, countryCode = "US") {
  return cjFetch<{ orderId: string; orderAmount?: number | string; orderStatus?: string }>("/shopping/order/createOrderV2", {
    method: "POST",
    token,
    body: JSON.stringify({
      ...o,
      shippingCountryCode: countryCode,
      shippingCountry: COUNTRY_NAMES[countryCode] ?? countryCode,
      fromCountryCode: countryCode,
      payType: 2,
    }),
  });
}

export interface CjOrderDetail {
  orderId: string;
  orderNumber?: string;
  orderStatus?: string; // CREATED, IN_CART, UNPAID, PENDING, PROCESSING, UNSHIPPED, SHIPPED, DELIVERED, CANCELLED, OTHER
  trackNumber?: string;
  logisticName?: string;
  orderAmount?: number | string;
}

export function getOrderDetail(token: string, orderId: string) {
  return cjFetch<CjOrderDetail>(`/shopping/order/getOrderDetail?${new URLSearchParams({ orderId })}`, { token });
}

/** Supprime une commande CJ (possible seulement tant qu'elle n'est ni payée ni traitée). */
export function deleteOrder(token: string, orderId: string) {
  return cjFetch<unknown>(`/shopping/order/deleteOrder?${new URLSearchParams({ orderId })}`, { method: "DELETE", token });
}

export function trackInfo(token: string, trackNumber: string) {
  return cjFetch<unknown>(`/logistic/trackInfo?${new URLSearchParams({ trackNumber })}`, { token });
}

export function parseMaxDays(aging: string | undefined): number {
  const nums = (aging ?? "").match(/\d+/g)?.map(Number) ?? [];
  return nums.length ? Math.max(...nums) : 99;
}

/** Solde du portefeuille CJ (USD, champ « amount ») : sert à payer les commandes automatiques (payType 2). Doc : Shopping › 2.1 Get Balance. */
export async function getBalance(token: string): Promise<number> {
  const d = await cjFetch<{ balance?: number | string; amount?: number | string }>("/shopping/pay/getBalance", { token });
  const v = Number(d?.balance ?? d?.amount);
  if (!Number.isFinite(v)) throw new Error(`CJ getBalance: unexpected response ${JSON.stringify(d).slice(0, 200)}`);
  return v;
}
