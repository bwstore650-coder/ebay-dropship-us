/**
 * Interface commune des fournisseurs, côté AliExpress (passerelle simulée) :
 * renouvellement du jeton, cotation, commande avec le code de variante, états de commande.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const updates = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("@/lib/db", () => ({ db: { supplierAccount: { update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => updates.push(data)) } } }));
vi.mock("@/lib/crypto", () => ({ decrypt: (s: string) => s, encrypt: (s: string) => `enc:${s}` }));

import { openSession, placeSupplierOrder, productInfo, quote, supplierOrderState, SupplierError } from "./index";

let gateway: (method: string, params: URLSearchParams, url: string) => unknown;
let calls: { url: string; method: string; params: URLSearchParams }[] = [];

const product = {
  aliexpress_ds_product_get_response: {
    result: {
      ae_item_base_info_dto: { product_id: 1005001234567890, subject: "Electric Can Opener", detail: "<p>Opens cans</p>" },
      ae_multimedia_info_dto: { image_urls: "https://ae01.alicdn.com/1.jpg" },
      ae_item_sku_info_dtos: [
        { id: "SKU-US", offer_sale_price: "7.50", sku_available_stock: 40, aeop_s_k_u_propertys: [{ sku_property_id: 14, property_value_id: 193, sku_property_name: "Color", property_value_definition_name: "Black" }, { sku_property_id: 200007763, property_value_id_long: 201336100, sku_property_name: "Ships From", sku_property_value: "United States" }] },
        { id: "SKU-CN", sku_price: "5.00", sku_available_stock: 999, aeop_s_k_u_propertys: [{ sku_property_id: 14, property_value_id: 29, sku_property_name: "Color", sku_property_value: "White" }] },
        { id: "SKU-EMPTY", sku_price: "5.00", sku_available_stock: 0, aeop_s_k_u_propertys: [{ sku_property_id: 200007763, property_value_id_long: 201336100, sku_property_name: "Ships From", sku_property_value: "United States" }] },
      ],
    },
  },
};
const freight = { aliexpress_logistics_buyer_freight_calculate_response: { result: { success: true, aeop_freight_calculate_result_for_buyer_d_t_o_list: [{ service_name: "USPS", freight: { amount: 2.99 }, estimated_delivery_time: "3-6" }] } } };

beforeEach(() => {
  vi.stubEnv("ALIEXPRESS_APP_KEY", "12345");
  vi.stubEnv("ALIEXPRESS_APP_SECRET", "secretXYZ");
  updates.length = 0;
  calls = [];
  gateway = (method) => (method === "aliexpress.ds.product.get" ? product : method === "aliexpress.logistics.buyer.freight.calculate" ? freight : {});
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const params = new URLSearchParams(String(init?.body));
    const method = params.get("method") ?? new URL(url).pathname;
    calls.push({ url, method, params });
    return new Response(JSON.stringify(gateway(method, params, url)));
  }));
});

const aeAccount = (expiresInMs: number) => ({ id: "SA1", supplier: "ALIEXPRESS", accessToken: "OLD", refreshToken: "REFRESH", expiresAt: new Date(Date.now() + expiresInMs) });

describe("session AliExpress", () => {
  it("jeton valide : utilisé tel quel", async () => {
    const s = await openSession([aeAccount(86_400_000)], "ALIEXPRESS");
    expect(s).toMatchObject({ supplier: "ALIEXPRESS", session: "OLD" });
    expect(calls).toHaveLength(0);
  });
  it("jeton bientôt expiré : renouvelé et enregistré chiffré", async () => {
    gateway = () => ({ access_token: "NEW", refresh_token: "R2", expire_time: 1_900_000_000_000, refresh_token_valid_time: 1_950_000_000_000, code: "0" });
    const s = await openSession([aeAccount(60_000)], "ALIEXPRESS");
    expect(s).toMatchObject({ session: "NEW" });
    expect(calls[0].url).toBe("https://api-sg.aliexpress.com/rest/auth/token/refresh");
    expect(calls[0].params.get("refresh_token")).toBe("REFRESH");
    expect(updates[0]).toEqual({ accessToken: "enc:NEW", refreshToken: "enc:R2", expiresAt: new Date(1_900_000_000_000) });
  });
  it("renouvellement refusé : reconnexion demandée ; fournisseur non connecté : refus", async () => {
    gateway = () => ({ code: "IllegalRefreshToken", message: "refresh token expired" });
    await expect(openSession([aeAccount(60_000)], "ALIEXPRESS")).rejects.toMatchObject({ code: "SUPPLIER_RECONNECT" });
    await expect(openSession([], "ALIEXPRESS")).rejects.toBeInstanceOf(SupplierError);
  });
});

describe("cotation et commande AliExpress", () => {
  const session = { supplier: "ALIEXPRESS" as const, cfg: { appKey: "12345", appSecret: "secretXYZ" }, session: "S" };

  it("variante expédiée des États-Unis : cotée ; variante de Chine : pas de livraison locale ; rupture", async () => {
    expect(await quote(session, "1005001234567890", "SKU-US", 1, "US")).toEqual({ kind: "ok", stock: 40, unitPrice: 7.5, shipping: 2.99, deliveryDaysMax: 6, service: "USPS", taxRate: 0.07 });
    expect(await quote(session, "1005001234567890", "SKU-CN", 1, "US")).toEqual({ kind: "no_route", stock: 999 });
    expect(await quote(session, "1005001234567890", "SKU-EMPTY", 1, "US")).toEqual({ kind: "no_stock" });
    expect(await quote(session, "1005001234567890", "SKU-GONE", 1, "US")).toEqual({ kind: "gone" });
  });

  it("produit retiré : « gone » ; panne : erreur (rien n'est modifié)", async () => {
    gateway = () => ({ error_response: { code: "isv.product-not-exist", msg: "Product not exist" } });
    expect(await quote(session, "1", "x", 1, "US")).toEqual({ kind: "gone" });
    expect(await productInfo(session, "1", "x", "US")).toBeNull();
    gateway = () => ({ error_response: { code: "isp.timeout", msg: "Remote service timeout" } });
    await expect(quote(session, "1", "x", 1, "US")).rejects.toThrow("timeout");
  });

  it("fiche produit : photo de la variante en premier, attributs", async () => {
    const info = await productInfo(session, "1005001234567890", "SKU-US", "US");
    expect(info).toMatchObject({ productId: "1005001234567890", variantId: "SKU-US", title: "Electric Can Opener", variantLabel: "Black / United States" });
    expect(info!.images).toEqual(["https://ae01.alicdn.com/1.jpg"]);
  });

  it("commande : le code de variante (sku_attr) est relu sur la fiche produit", async () => {
    gateway = (method) =>
      method === "aliexpress.ds.product.get" ? product : { aliexpress_ds_order_create_response: { result: { is_success: true, order_list: { number: [111, 222] } } } };
    const r = await placeSupplierOrder(session, {
      orderNumber: "EB-9",
      service: "USPS",
      address: { fullName: "Jane", address: "1 Main", city: "Austin", province: "TX", zip: "73301", country: "US" },
      lines: [{ productId: "1005001234567890", variantId: "SKU-US", quantity: 1 }],
    });
    expect(r).toEqual({ orderId: "111,222" });
    const body = JSON.parse(calls.find((c) => c.method === "aliexpress.ds.order.create")!.params.get("param_place_order_request4_open_api_d_t_o")!);
    expect(body.product_items).toEqual([{ product_id: 1005001234567890, sku_attr: "14:193#Black;200007763:201336100", product_count: 1, logistics_service_name: "USPS" }]);
    expect(body.out_order_id).toBe("EB-9");
  });

  it("états de commande : à payer, en cours, expédiée, annulée", async () => {
    const order = (status: string, tracking?: string) => () => ({
      aliexpress_trade_ds_order_get_response: { result: { order_status: status, ...(tracking ? { logistics_info_list: [{ logistics_no: tracking, logistics_service: "USPS" }] } : {}) } },
    });
    gateway = order("PLACE_ORDER_SUCCESS");
    expect(await supplierOrderState(session, "111,222")).toEqual({ state: "UNPAID" });
    expect(calls.at(-1)!.params.get("single_order_query")).toBe('{"order_id":111}');
    gateway = order("WAIT_SELLER_SEND_GOODS");
    expect(await supplierOrderState(session, "111")).toEqual({ state: "PENDING" });
    gateway = order("WAIT_BUYER_ACCEPT_GOODS", "9400111");
    expect(await supplierOrderState(session, "111")).toEqual({ state: "SHIPPED", trackingNumber: "9400111", carrierName: "USPS" });
    gateway = order("IN_CANCEL");
    expect(await supplierOrderState(session, "111")).toEqual({ state: "CANCELLED" });
  });
});
