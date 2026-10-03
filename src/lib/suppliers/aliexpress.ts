/**
 * Client AliExpress Open Platform (programme Dropshipping).
 * Portail : https://openservice.aliexpress.com — l'application doit avoir l'accès « Dropshipping » validé.
 *
 * Passerelle : https://api-sg.aliexpress.com
 *   - /sync  : appels métier (paramètre `method`)
 *   - /rest/<chemin> : API système (jetons OAuth)
 * Signature : HMAC-SHA256 (clé = app secret) sur les paramètres triés par nom, concaténés « nomvaleur » ;
 * pour /rest, le chemin de l'API est placé devant. Résultat en hexadécimal MAJUSCULE.
 *
 * Méthodes utilisées (noms vérifiés dans le SDK ae_sdk 0.6.0, qui suit la doc officielle) :
 *   aliexpress.ds.product.get, aliexpress.logistics.buyer.freight.calculate,
 *   aliexpress.ds.order.create, aliexpress.trade.ds.order.get.
 * Les réponses existent sous deux formes (listes « à plat » ou imbriquées) : tout passe par `list()`.
 */
import crypto from "node:crypto";
import type { SupplierOffer } from "@/lib/margin";
import { pickShipping } from "./shipping";

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
  const q = new URLSearchParams({ response_type: "code", force_auth: "true", redirect_uri: redirectUri, client_id: cfg.appKey, state });
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

export class AeError extends Error {}

export interface AeToken {
  access_token: string;
  refresh_token: string;
  expire_time: number;              // horodatage (ms) d'expiration du jeton
  refresh_token_valid_time: number; // horodatage (ms) d'expiration du jeton de renouvellement
  user_nick?: string;
  code?: string;
  message?: string;
}

async function token(cfg: AeConfig, path: string, params: Record<string, string>): Promise<AeToken> {
  const t = await rest<AeToken>(cfg, path, params);
  if (!t.access_token || (t.code && t.code !== "0")) throw new AeError(`AliExpress ${path} : ${t.message ?? t.code ?? "jeton absent"}`);
  return t;
}
export const createToken = (cfg: AeConfig, code: string) => token(cfg, "/auth/token/create", { code });
export const refreshToken = (cfg: AeConfig, refresh_token: string) => token(cfg, "/auth/token/refresh", { refresh_token });

/** Appel métier générique via /sync ; renvoie le contenu de la clé « …_response ». */
export async function call<T = Record<string, unknown>>(
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
  if ("error_response" in json) {
    const e = json.error_response as { code?: string; msg?: string; sub_msg?: string };
    throw new AeError(`AliExpress ${method} : ${e.sub_msg || e.msg || e.code || "erreur"}`);
  }
  const key = Object.keys(json).find((k) => k.endsWith("_response"));
  return (key ? json[key] : json) as T;
}

/** Liste « à plat » ou imbriquée ({ ae_item_sku_info_d_t_o: [...] }) → tableau. */
export function list<T = Record<string, unknown>>(v: unknown, ...inner: string[]): T[] {
  if (Array.isArray(v)) return v as T[];
  if (v && typeof v === "object") {
    for (const k of inner) {
      const x = (v as Record<string, unknown>)[k];
      if (Array.isArray(x)) return x as T[];
      if (x !== undefined && x !== null) return [x as T];
    }
  }
  return [];
}

/* ---------- Produit ---------- */

/** Pays d'expédition des variantes (propriété « Ships From ») → code pays. */
const SHIPS_FROM: Record<string, string> = {
  "united states": "US", usa: "US", us: "US", canada: "CA", ca: "CA", "united kingdom": "GB", uk: "GB", gb: "GB",
  australia: "AU", au: "AU", germany: "DE", de: "DE", france: "FR", fr: "FR", italy: "IT", it: "IT", spain: "ES", es: "ES",
  ireland: "IE", ie: "IE", china: "CN", cn: "CN", poland: "PL", "czech republic": "CZ", belgium: "BE", brazil: "BR",
  "russian federation": "RU", turkey: "TR", "saudi arabia": "SA", "united arab emirates": "AE", israel: "IL", chile: "CL",
};

export interface AeSku {
  skuId: string;
  skuAttr: string;       // à envoyer à la commande, ex. « 14:193#Black;200007763:201336100 »
  price: number;         // prix de la variante (devise demandée, USD)
  stock: number;
  shipsFrom: string;     // code pays d'expédition (CN par défaut)
  label: string;         // ex. « Black / United States »
  image?: string;
}

export interface AeProduct {
  productId: string;
  title: string;
  descriptionHtml: string;
  images: string[];
  attributes: string[];  // « Material: ABS »…
  skus: AeSku[];
}

type RawProp = { sku_property_id?: number; property_value_id?: number; property_value_id_long?: number; sku_property_name?: string; sku_property_value?: string; property_value_definition_name?: string; sku_image?: string };
type RawSku = {
  id?: string; sku_id?: string | number; sku_attr?: string; sku_price?: string; offer_sale_price?: string;
  sku_available_stock?: number; s_k_u_available_stock?: number; ipm_sku_stock?: number; sku_stock?: boolean;
  aeop_s_k_u_propertys?: unknown; ae_sku_property_dtos?: unknown;
};

export function parseProduct(r: Record<string, unknown>): AeProduct {
  const result = (r.result ?? r) as Record<string, unknown>;
  const base = (result.ae_item_base_info_dto ?? {}) as Record<string, unknown>;
  const media = (result.ae_multimedia_info_dto ?? {}) as { image_urls?: string };
  const images = String(media.image_urls ?? "").split(";").map((s) => s.trim()).filter(Boolean);
  const attributes = list<{ attr_name?: string; attr_value?: string }>(result.ae_item_properties, "ae_item_property")
    .filter((a) => a.attr_name && a.attr_value)
    .map((a) => `${a.attr_name}: ${a.attr_value}`);
  const skus = list<RawSku>(result.ae_item_sku_info_dtos, "ae_item_sku_info_d_t_o").map((s): AeSku => {
    const props = list<RawProp>(s.aeop_s_k_u_propertys ?? s.ae_sku_property_dtos, "ae_sku_property_d_t_o", "aeop_sku_property");
    const shipProp = props.find((p) => /ships?\s*from/i.test(p.sku_property_name ?? ""));
    const shipName = (shipProp?.property_value_definition_name || shipProp?.sku_property_value || "").trim().toLowerCase();
    const skuAttr =
      s.sku_attr ||
      props.map((p) => `${p.sku_property_id}:${p.property_value_id_long ?? p.property_value_id}${p.property_value_definition_name ? `#${p.property_value_definition_name}` : ""}`).join(";");
    const stock = s.sku_available_stock ?? s.s_k_u_available_stock ?? s.ipm_sku_stock ?? (s.sku_stock ? 1 : 0);
    return {
      skuId: String(s.sku_id ?? s.id ?? skuAttr),
      skuAttr,
      price: Number(s.offer_sale_price || s.sku_price || 0),
      stock: Number(stock) || 0,
      shipsFrom: shipProp ? (SHIPS_FROM[shipName] ?? shipName.toUpperCase().slice(0, 2)) : "CN",
      label: props.map((p) => p.property_value_definition_name || p.sku_property_value).filter(Boolean).join(" / "),
      image: props.find((p) => p.sku_image)?.sku_image,
    };
  });
  return {
    productId: String(base.product_id ?? ""),
    title: String(base.subject ?? ""),
    descriptionHtml: String(base.detail ?? base.mobile_detail ?? ""),
    images,
    attributes,
    skus,
  };
}

export async function getProduct(cfg: AeConfig, session: string, productId: string, country = "US"): Promise<AeProduct> {
  const r = await call(cfg, "aliexpress.ds.product.get", session, {
    product_id: productId,
    ship_to_country: country,
    target_currency: "USD",
    target_language: "en",
  });
  const p = parseProduct(r);
  if (!p.skus.length) throw new AeError("AliExpress : product not found");
  return { ...p, productId: p.productId || productId };
}

/* ---------- Livraison ---------- */

export interface AeShipping { service: string; amountUsd: number; deliveryDaysMax: number }

/** « 3-7 », « 7 » ou « 5~10 » → plus grand nombre de jours ; 99 si inconnu. */
export function maxDays(s: unknown): number {
  const nums = String(s ?? "").match(/\d+/g)?.map(Number) ?? [];
  return nums.length ? Math.max(...nums) : 99;
}

/** Modes de livraison d'une variante, depuis l'entrepôt `sendFrom` vers le pays `country`. */
export async function shipping(
  cfg: AeConfig, session: string,
  q: { productId: string; skuId: string; quantity: number; country: string; sendFrom: string },
): Promise<AeShipping[]> {
  const r = await call<{ result?: Record<string, unknown> }>(cfg, "aliexpress.logistics.buyer.freight.calculate", session, {
    param_aeop_freight_calculate_for_buyer_d_t_o: {
      country_code: q.country,
      product_id: Number(q.productId),
      product_num: q.quantity,
      send_goods_country_code: q.sendFrom,
      sku_id: q.skuId,
      price_currency: "USD",
    },
  });
  const result = r.result ?? {};
  if (result.success === false) return [];
  return list<{ service_name?: string; freight?: { amount?: number | string; cent?: number }; estimated_delivery_time?: string; error_code?: number }>(
    result.aeop_freight_calculate_result_for_buyer_d_t_o_list ?? result.aeop_freight_calculate_result_for_buyer_dtolist,
    "aeop_freight_calculate_result_for_buyer_dto",
    "aeop_freight_calculate_result_for_buyer_d_t_o",
  )
    .filter((o) => o.service_name && !o.error_code)
    .map((o) => ({
      service: o.service_name!,
      amountUsd: o.freight?.amount !== undefined ? Number(o.freight.amount) : Number(o.freight?.cent ?? 0) / 100,
      deliveryDaysMax: maxDays(o.estimated_delivery_time),
    }));
}

/* ---------- Commandes ---------- */

const PHONE_PREFIX: Record<string, string> = { US: "+1", CA: "+1", GB: "+44", AU: "+61", DE: "+49", FR: "+33", IT: "+39", ES: "+34", IE: "+353" };

export interface AeAddressInput {
  fullName: string;
  address: string;
  address2?: string;
  city: string;
  province: string;
  zip: string;
  phone?: string;
  country: string;
}

/**
 * Commande AliExpress pour le client final. `try_to_pay` : paiement automatique avec le moyen enregistré
 * sur le compte AliExpress du vendeur ; sinon la commande attend d'être payée dans AliExpress.
 */
export async function createOrder(
  cfg: AeConfig, session: string,
  o: { outOrderId: string; address: AeAddressInput; items: { productId: string; skuAttr: string; quantity: number; service?: string }[] },
): Promise<{ orderIds: string[] }> {
  const a = o.address;
  const r = await call<{ result?: { is_success?: boolean; error_code?: string; error_msg?: string; order_list?: unknown } }>(cfg, "aliexpress.ds.order.create", session, {
    ds_extend_request: { payment: { pay_currency: "USD", try_to_pay: "true" } },
    param_place_order_request4_open_api_d_t_o: {
      out_order_id: o.outOrderId,
      logistics_address: {
        full_name: a.fullName,
        contact_person: a.fullName,
        address: a.address,
        ...(a.address2 ? { address2: a.address2 } : {}),
        city: a.city,
        province: a.province,
        zip: a.zip,
        country: a.country,
        ...(a.phone ? { mobile_no: a.phone, phone_country: PHONE_PREFIX[a.country] ?? "" } : {}),
        locale: "en_US",
      },
      product_items: o.items.map((i) => ({
        product_id: Number(i.productId),
        sku_attr: i.skuAttr,
        product_count: i.quantity,
        ...(i.service ? { logistics_service_name: i.service } : {}),
      })),
    },
  });
  const res = r.result ?? {};
  if (!res.is_success) throw new AeError(`AliExpress commande : ${res.error_code ?? ""} ${res.error_msg ?? ""}`.trim());
  const ids = list<string | number>(res.order_list, "number").map(String);
  if (!ids.length) throw new AeError("AliExpress commande : aucun numéro de commande");
  return { orderIds: ids };
}

export interface AeOrderInfo {
  status: string;          // PLACE_ORDER_SUCCESS (à payer), WAIT_SELLER_SEND_GOODS, SELLER_PART_SEND_GOODS, WAIT_BUYER_ACCEPT_GOODS, FINISH, IN_CANCEL…
  amountUsd: number | null;
  tracking: { number: string; service: string }[];
}

export async function getOrder(cfg: AeConfig, session: string, orderId: string): Promise<AeOrderInfo> {
  const r = await call<{ result?: Record<string, unknown> }>(cfg, "aliexpress.trade.ds.order.get", session, {
    single_order_query: { order_id: Number(orderId) },
  });
  const res = r.result ?? {};
  const amount = res.order_amount as { amount?: string } | undefined;
  return {
    status: String(res.order_status ?? ""),
    amountUsd: amount?.amount ? Number(amount.amount) : null,
    tracking: list<{ logistics_no?: string; logistics_service?: string }>(res.logistics_info_list, "ae_order_logistics_info")
      .filter((t) => t.logistics_no)
      .map((t) => ({ number: t.logistics_no!, service: t.logistics_service ?? "" })),
  };
}

/* ---------- Offres pour le chercheur ---------- */

/**
 * Taxe facturée par AliExpress à l'achat, par pays (ESTIMATIONS à affiner) :
 * US ≈ 7 % (taxe de vente, varie selon l'État), CA ≈ 13 % (TPS/TVH), GB 20 % (TVA), AU 10 % (GST),
 * UE : TVA du pays (DE 19 %, FR 20 %, IT 22 %, ES 21 %, IE 23 %). Estimation volontairement prudente.
 */
export const AE_TAX_ESTIMATE: Record<string, number> = {
  US: 0.07, CA: 0.13, GB: 0.2, AU: 0.1, DE: 0.19, FR: 0.2, IT: 0.22, ES: 0.21, IE: 0.23,
};

/** Numéro de produit depuis un lien AliExpress (…/item/1005001234567890.html) ou un numéro seul. */
export function parseProductId(input: string): string | null {
  const t = input.trim();
  if (/^\d{8,20}$/.test(t)) return t;
  const m = t.match(/aliexpress\.[a-z.]+\/(?:item|i)\/(\d{8,20})\.html/i) ?? t.match(/[?&](?:productId|product_id)=(\d{8,20})/i);
  return m ? m[1] : null;
}

/* ---------- Recherche ---------- */

export interface AeSearchItem { productId: string; title: string; image: string | null; price: number | null; orders: number | null }

/** Recherche par mots-clés (catalogue Dropshipping), livrable dans le pays ; les plus vendus d'abord. */
export async function textSearch(
  cfg: AeConfig, session: string,
  q: { keyword: string; country: string; page?: number; pageSize?: number; sortBy?: string },
): Promise<AeSearchItem[]> {
  const r = await call<{ data?: { products?: unknown }; code?: string; msg?: string }>(cfg, "aliexpress.ds.text.search", session, {
    keyWord: q.keyword,
    local: "en_US",
    countryCode: q.country,
    currency: "USD",
    pageIndex: q.page ?? 1,
    pageSize: q.pageSize ?? 20,
    sortBy: q.sortBy ?? "orders,desc",
  });
  if (r.code && r.code !== "0" && !r.data) throw new AeError(`AliExpress aliexpress.ds.text.search : ${r.msg ?? r.code}`);
  return list<Record<string, unknown>>(r.data?.products, "selection_search_product", "product")
    .map((it) => {
      const num = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(String(v).replace(/[^\d.]/g, "")) || null);
      const img = String(it.itemMainPic ?? it.item_main_pic ?? "");
      return {
        productId: String(it.itemId ?? it.item_id ?? ""),
        title: String(it.title ?? ""),
        image: img ? (img.startsWith("//") ? `https:${img}` : img) : null,
        price: num(it.targetSalePrice ?? it.salePrice ?? it.target_sale_price),
        orders: num(it.orders),
      };
    })
    .filter((it) => /^\d{6,20}$/.test(it.productId));
}

export interface AeImageMatch { productId: string; title: string; image: string | null; shipFrom: string | null; similarity: number }

/** Recherche par photo (même produit chez AliExpress), livrable dans le pays. Les plus ressemblants d'abord. */
export async function imageSearch(cfg: AeConfig, session: string, q: { imageBase64: string; country: string }): Promise<AeImageMatch[]> {
  const r = await call<{ result?: { data?: unknown; ret?: string | boolean } }>(cfg, "aliexpress.ds.image.searchV2", session, {
    param0: { image_base64: q.imageBase64, ship_to: q.country, currency: "USD", lang: "en", search_type: "same" },
  });
  return list<Record<string, unknown>>(r.result?.data, "data", "product")
    .map((it) => {
      const img = String(it.product_main_image_url ?? "");
      return {
        productId: String(it.product_id ?? ""),
        title: String(it.product_title ?? ""),
        image: img ? (img.startsWith("//") ? `https:${img}` : img) : null,
        shipFrom: it.ship_from ? String(it.ship_from).toUpperCase() : null,
        similarity: Number(it.similarity_score ?? 0) || 0,
      };
    })
    .filter((it) => /^\d{6,20}$/.test(it.productId))
    .sort((a, b) => b.similarity - a.similarity);
}

/** Variantes expédiées depuis un entrepôt du pays, en stock, avec la livraison la moins chère (USD). */
export async function offersFor(cfg: AeConfig, session: string, productId: string, country: string, maxSkus = 5): Promise<SupplierOffer[]> {
  return offersFromProduct(cfg, session, await getProduct(cfg, session, productId, country), country, maxSkus);
}

/** Variantes en stock dans un entrepôt du pays (les moins chères d'abord). */
export const localSkus = (p: AeProduct, country: string) => p.skus.filter((s) => s.shipsFrom === country && s.stock > 0).sort((a, b) => a.price - b.price);

/** Offres d'un produit déjà chargé (évite un second appel produit). */
export async function offersFromProduct(cfg: AeConfig, session: string, p: AeProduct, country: string, maxSkus = 5): Promise<SupplierOffer[]> {
  const local = localSkus(p, country).slice(0, maxSkus);
  const offers: SupplierOffer[] = [];
  for (const s of local) {
    const options = await shipping(cfg, session, { productId: p.productId, skuId: s.skuId, quantity: 1, country, sendFrom: country });
    if (!options.length) continue;
    const best = pickShipping(options, (o) => o.amountUsd, (o) => o.deliveryDaysMax)!;
    offers.push({
      supplier: "ALIEXPRESS",
      productId: p.productId,
      variantId: s.skuId,
      title: `${p.title}${s.label ? ` — ${s.label}` : ""}`,
      price: s.price,
      shipping: best.amountUsd,
      taxRate: AE_TAX_ESTIMATE[country] ?? AE_TAX_ESTIMATE.US,
      stockUs: s.stock,
      deliveryDaysMax: best.deliveryDaysMax,
      url: `https://www.aliexpress.com/item/${p.productId}.html`,
    });
  }
  return offers;
}
