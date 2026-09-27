/**
 * Client AliExpress Open Platform (programme Dropshipping).
 * Portail : https://openservice.aliexpress.com — l'accès « DS » doit être demandé et validé.
 *
 * Passerelle : https://api-sg.aliexpress.com
 *   - /sync  : appels métier (paramètre `method`)
 *   - /rest/<chemin> : API système (jetons OAuth)
 * Signature : HMAC-SHA256 (clé = app secret) sur les paramètres triés par nom,
 * concaténés « nomvaleur » ; pour /rest, le chemin de l'API est placé devant. Résultat en hexadécimal MAJUSCULE.
 *
 * ⚠️ Les noms des méthodes métier et la forme exacte de leurs paramètres sont à confirmer
 * dans la doc de ton application une fois l'accès DS accordé (marqués « À VÉRIFIER »).
 */
import crypto from "node:crypto";
import type { SupplierOffer } from "@/lib/margin";

const GATEWAY = "https://api-sg.aliexpress.com";

export interface AeConfig {
  appKey: string;
  appSecret: string;
}

export function sign(params: Record<string, string>, secret: string, apiPath = ""): string {
  const base = apiPath + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return crypto.createHmac("sha256", secret).update(base, "utf8").digest("hex").toUpperCase();
}

function systemParams(cfg: AeConfig): Record<string, string> {
  return { app_key: cfg.appKey, timestamp: String(Date.now()), sign_method: "sha256" };
}

/** Lien vers lequel on envoie le client pour autoriser notre app sur son compte AliExpress. */
export function authorizeUrl(cfg: AeConfig, redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    response_type: "code",
    force_auth: "true",
    redirect_uri: redirectUri,
    client_id: cfg.appKey,
    state,
  });
  return `${GATEWAY}/oauth/authorize?${q}`;
}

async function rest<T>(cfg: AeConfig, apiPath: string, params: Record<string, string>): Promise<T> {
  const all = { ...systemParams(cfg), ...params };
  all.sign = sign(all, cfg.appSecret, apiPath);
  const res = await fetch(`${GATEWAY}/rest${apiPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: new URLSearchParams(all),
  });
  return (await res.json()) as T;
}

export interface AeToken {
  access_token: string;
  refresh_token: string;
  expire_time: number;          // horodatage ms
  refresh_token_valid_time: number;
  user_nick?: string;
  code?: string;
  message?: string;
}

export function createToken(cfg: AeConfig, code: string) {
  return rest<AeToken>(cfg, "/auth/token/create", { code });
}

export function refreshToken(cfg: AeConfig, refresh_token: string) {
  return rest<AeToken>(cfg, "/auth/token/refresh", { refresh_token });
}

/** Appel métier générique via /sync. */
export async function call<T = unknown>(
  cfg: AeConfig,
  method: string,
  session: string,
  params: Record<string, string | number | object> = {},
): Promise<T> {
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) flat[k] = typeof v === "object" ? JSON.stringify(v) : String(v);
  const all: Record<string, string> = { ...systemParams(cfg), method, session, ...flat };
  all.sign = sign(all, cfg.appSecret);
  const res = await fetch(`${GATEWAY}/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: new URLSearchParams(all),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if ("error_response" in json) throw new Error(`AliExpress ${method} : ${JSON.stringify(json.error_response)}`);
  return json as T;
}

/** Fiche produit livrée dans le pays. À VÉRIFIER : paramètres et forme de la réponse. */
export function getProduct(cfg: AeConfig, session: string, productId: string, country = "US", currency = "USD") {
  return call(cfg, "aliexpress.ds.product.get", session, {
    product_id: productId,
    ship_to_country: country,
    target_currency: currency,
    target_language: "en",
  });
}

/** Frais de port vers une adresse US. À VÉRIFIER : structure de `queryDeliveryReq`. */
export function freightQuery(cfg: AeConfig, session: string, productId: string, skuId: string, quantity = 1, country = "US", currency = "USD") {
  return call(cfg, "aliexpress.ds.freight.query", session, {
    queryDeliveryReq: {
      productId,
      selectedSkuId: skuId,
      quantity,
      shipToCountry: country,
      currency,
      language: "en_US",
      locale: "en_US",
    },
  });
}

export interface AeAddress {
  contact_person: string;
  address: string;
  address2?: string;
  city: string;
  province: string;
  zip: string;
  phone_country?: string;
  mobile_no?: string;
}

/** Commande pour le client final. À VÉRIFIER : nom exact du paramètre DTO. */
export function createOrder(
  cfg: AeConfig,
  session: string,
  outOrderId: string,
  address: AeAddress,
  items: { product_id: string; sku_attr: string; product_count: number; logistics_service_name?: string }[],
  country = "US",
) {
  return call(cfg, "aliexpress.ds.order.create", session, {
    param_place_order_request4_open_api_d_t_o: {
      out_order_id: outOrderId,
      logistics_address: { country, ...address },
      product_items: items,
    },
  });
}

export function getOrder(cfg: AeConfig, session: string, orderId: string) {
  return call(cfg, "aliexpress.trade.ds.order.get", session, { single_order_query: { order_id: orderId } });
}

export function getTracking(cfg: AeConfig, session: string, orderId: string) {
  return call(cfg, "aliexpress.ds.order.tracking.get", session, { ae_order_id: orderId, language: "en_US" });
}

/**
 * Taxe facturée par AliExpress à l'achat, par pays (ESTIMATIONS à affiner) :
 * US ≈ 7 % (taxe de vente, varie selon l'État), CA ≈ 13 % (TPS/TVH, varie selon la province),
 * GB 20 % (TVA), AU 10 % (GST), UE : TVA du pays (DE 19 %, FR 20 %, IT 22 %, ES 21 %, IE 23 %).
 * Pour un vendeur européen assujetti, cette TVA est récupérable : estimation volontairement prudente.
 */
export const AE_TAX_ESTIMATE: Record<string, number> = {
  US: 0.07, CA: 0.13, GB: 0.2, AU: 0.1, DE: 0.19, FR: 0.2, IT: 0.22, ES: 0.21, IE: 0.23,
};
export const AE_US_SALES_TAX_ESTIMATE = AE_TAX_ESTIMATE.US;

export function toOffer(input: {
  productId: string;
  skuId: string;
  title: string;
  price: number;
  shipping: number;
  stockUs: number;
  deliveryDaysMax: number;
  country?: string;
}): SupplierOffer {
  return {
    supplier: "ALIEXPRESS",
    productId: input.productId,
    variantId: input.skuId,
    title: input.title,
    price: input.price,
    shipping: input.shipping,
    taxRate: AE_TAX_ESTIMATE[input.country ?? "US"] ?? AE_US_SALES_TAX_ESTIMATE,
    stockUs: input.stockUs,
    deliveryDaysMax: input.deliveryDaysMax,
    url: `https://www.aliexpress.com/item/${input.productId}.html`,
  };
}
