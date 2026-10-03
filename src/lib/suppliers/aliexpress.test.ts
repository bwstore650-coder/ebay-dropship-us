import { afterEach, describe, expect, it, vi } from "vitest";
import { createOrder, getOrder, list, maxDays, offersFor, parseProduct, parseProductId, sign, textSearch } from "./aliexpress";

describe("signature AliExpress", () => {
  it("trie les paramètres et signe en HMAC-SHA256 majuscule", () => {
    const s = sign({ b: "2", a: "1" }, "secret");
    expect(s).toMatch(/^[0-9A-F]{64}$/);
    expect(sign({ a: "1", b: "2" }, "secret")).toBe(s);
  });
  it("identique au SDK de référence (ae_sdk 0.6.0), appel métier et API système", () => {
    // Valeurs calculées avec l'implémentation du SDK ae_sdk pour les mêmes paramètres.
    expect(
      sign({ method: "aliexpress.ds.product.get", session: "SESS", app_key: "12345", sign_method: "sha256", timestamp: "1790000000000", product_id: "1005001234567890", ship_to_country: "US", target_currency: "USD", target_language: "en" }, "secretXYZ"),
    ).toBe("62B94DD91E92C5F6E1B4BAC59530457910A143978D51C8AB3CBDF48C0651AD89");
    expect(sign({ app_key: "12345", sign_method: "sha256", timestamp: "1790000000000", code: "abc" }, "secretXYZ", "/auth/token/create")).toBe(
      "2F33641E700186B4C143E403751A9EFA6C41BAE7264DE2A70E3B6AEC93B9D717",
    );
  });
});

const rawProduct = (nested: boolean) => {
  const props = [
    { sku_property_id: 14, property_value_id: 193, sku_property_name: "Color", sku_property_value: "black", property_value_definition_name: "Black", sku_image: "https://ae01.alicdn.com/v.jpg" },
    { sku_property_id: 200007763, property_value_id_long: 201336100, sku_property_name: "Ships From", sku_property_value: "United States" },
  ];
  const skus = [
    { id: "12000001", offer_sale_price: "7.50", sku_price: "9.00", sku_available_stock: 40, ...(nested ? { ae_sku_property_dtos: { ae_sku_property_d_t_o: props } } : { aeop_s_k_u_propertys: props }) },
    { id: "12000002", sku_price: "6.00", sku_available_stock: 900, ...(nested ? { ae_sku_property_dtos: { ae_sku_property_d_t_o: [{ sku_property_id: 14, property_value_id: 29, sku_property_name: "Color", sku_property_value: "white" }] } } : { aeop_s_k_u_propertys: [{ sku_property_id: 14, property_value_id: 29, sku_property_name: "Color", sku_property_value: "white" }] }) },
  ];
  return {
    result: {
      ae_item_base_info_dto: { product_id: 1005001234567890, subject: "Electric Can Opener", detail: "<p>Opens cans</p>" },
      ae_multimedia_info_dto: { image_urls: "https://ae01.alicdn.com/1.jpg;https://ae01.alicdn.com/2.jpg" },
      ae_item_properties: nested ? { ae_item_property: [{ attr_name: "Material", attr_value: "ABS" }] } : [{ attr_name: "Material", attr_value: "ABS" }],
      ae_item_sku_info_dtos: nested ? { ae_item_sku_info_d_t_o: skus } : skus,
    },
  };
};

describe("fiche produit AliExpress", () => {
  for (const nested of [false, true]) {
    it(`lit les variantes, le pays d'expédition et le code de variante (réponse ${nested ? "imbriquée" : "à plat"})`, () => {
      const p = parseProduct(rawProduct(nested));
      expect(p).toMatchObject({ productId: "1005001234567890", title: "Electric Can Opener", images: ["https://ae01.alicdn.com/1.jpg", "https://ae01.alicdn.com/2.jpg"], attributes: ["Material: ABS"] });
      expect(p.skus[0]).toEqual({
        skuId: "12000001", skuAttr: "14:193#Black;200007763:201336100", price: 7.5, stock: 40, shipsFrom: "US",
        label: "Black / United States", image: "https://ae01.alicdn.com/v.jpg",
      });
      expect(p.skus[1]).toMatchObject({ skuId: "12000002", price: 6, shipsFrom: "CN", skuAttr: "14:29" });
    });
  }
  it("numéro de produit depuis un lien", () => {
    expect(parseProductId("https://fr.aliexpress.com/item/1005001234567890.html?spm=a2g0o")).toBe("1005001234567890");
    expect(parseProductId("https://www.aliexpress.us/item/3256801234567890.html")).toBe("3256801234567890");
    expect(parseProductId("1005001234567890")).toBe("1005001234567890");
    expect(parseProductId("https://amazon.com/dp/B00X")).toBeNull();
  });
  it("délais et listes", () => {
    expect(maxDays("3-7")).toBe(7);
    expect(maxDays("5~10")).toBe(10);
    expect(maxDays(undefined)).toBe(99);
    expect(list({ number: [1, 2] }, "number")).toEqual([1, 2]);
    expect(list({ number: 5 }, "number")).toEqual([5]);
  });
});

describe("appels AliExpress", () => {
  afterEach(() => vi.unstubAllGlobals());
  const cfg = { appKey: "12345", appSecret: "secretXYZ" };

  function mockGateway(handler: (method: string, params: URLSearchParams) => unknown) {
    const calls: { method: string; params: URLSearchParams }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const params = new URLSearchParams(String(init?.body));
      const method = params.get("method")!;
      calls.push({ method, params });
      return new Response(JSON.stringify(handler(method, params)));
    }));
    return calls;
  }

  it("offres : seulement les variantes du pays, livraison la moins chère, taxe estimée ; requêtes signées", async () => {
    const calls = mockGateway((method) =>
      method === "aliexpress.ds.product.get"
        ? { aliexpress_ds_product_get_response: rawProduct(true) }
        : {
            aliexpress_logistics_buyer_freight_calculate_response: {
              result: {
                success: true,
                aeop_freight_calculate_result_for_buyer_d_t_o_list: {
                  aeop_freight_calculate_result_for_buyer_dto: [
                    { service_name: "CAINIAO_FULFILLMENT_STD", freight: { amount: 2.99, currency_code: "USD" }, estimated_delivery_time: "3-6" },
                    { service_name: "USPS", freight: { amount: 4.5 }, estimated_delivery_time: "2-4" },
                  ],
                },
              },
            },
          },
    );
    const offers = await offersFor(cfg, "SESS", "1005001234567890", "US");
    expect(offers).toEqual([
      {
        supplier: "ALIEXPRESS", productId: "1005001234567890", variantId: "12000001", title: "Electric Can Opener — Black / United States",
        price: 7.5, shipping: 2.99, taxRate: 0.07, stockUs: 40, deliveryDaysMax: 6, url: "https://www.aliexpress.com/item/1005001234567890.html",
      },
    ]);
    const freight = calls.find((c) => c.method === "aliexpress.logistics.buyer.freight.calculate")!;
    expect(JSON.parse(freight.params.get("param_aeop_freight_calculate_for_buyer_d_t_o")!)).toEqual({
      country_code: "US", product_id: 1005001234567890, product_num: 1, send_goods_country_code: "US", sku_id: "12000001", price_currency: "USD",
    });
    for (const c of calls) {
      expect(c.params.get("session")).toBe("SESS");
      const { sign: s, ...rest } = Object.fromEntries(c.params);
      expect(s).toBe(sign(rest, cfg.appSecret));
    }
  });

  it("recherche par mots-clés : produits livrables dans le pays, les plus vendus d'abord", async () => {
    const calls = mockGateway(() => ({
      aliexpress_ds_text_search_response: {
        code: "0",
        data: { products: { selection_search_product: [
          { itemId: "1005001234567890", title: "Car Phone Holder", itemMainPic: "//ae01.alicdn.com/p.jpg", targetSalePrice: "6.62", orders: "1,204" },
          { itemId: "", title: "broken" },
        ] } },
      },
    }));
    const items = await textSearch(cfg, "SESS", { keyword: "phone holder", country: "US", page: 2 });
    expect(items).toEqual([{ productId: "1005001234567890", title: "Car Phone Holder", image: "https://ae01.alicdn.com/p.jpg", price: 6.62, orders: 1204 }]);
    const p = calls[0].params;
    expect([p.get("method"), p.get("keyWord"), p.get("countryCode"), p.get("pageIndex"), p.get("currency"), p.get("local"), p.get("sortBy")])
      .toEqual(["aliexpress.ds.text.search", "phone holder", "US", "2", "USD", "en_US", "orders,desc"]);
  });

  it("erreur de la passerelle : message lisible", async () => {
    mockGateway(() => ({ error_response: { code: "27", msg: "Invalid session", sub_msg: "session expired" } }));
    await expect(getOrder(cfg, "S", "1")).rejects.toThrow("session expired");
  });

  it("commande : adresse, variantes, paiement automatique demandé ; numéros de commande lus", async () => {
    const calls = mockGateway(() => ({ aliexpress_ds_order_create_response: { result: { is_success: true, order_list: { number: [8199999999999] } } } }));
    const r = await createOrder(cfg, "S", {
      outOrderId: "EB-1",
      address: { fullName: "Jane Doe", address: "1 Main St", city: "Austin", province: "TX", zip: "73301", phone: "5551234567", country: "US" },
      items: [{ productId: "1005001234567890", skuAttr: "14:193#Black;200007763:201336100", quantity: 2, service: "USPS" }],
    });
    expect(r).toEqual({ orderIds: ["8199999999999"] });
    const p = calls[0].params;
    expect(JSON.parse(p.get("ds_extend_request")!)).toEqual({ payment: { pay_currency: "USD", try_to_pay: "true" } });
    expect(JSON.parse(p.get("param_place_order_request4_open_api_d_t_o")!)).toEqual({
      out_order_id: "EB-1",
      logistics_address: { full_name: "Jane Doe", contact_person: "Jane Doe", address: "1 Main St", city: "Austin", province: "TX", zip: "73301", country: "US", mobile_no: "5551234567", phone_country: "+1", locale: "en_US" },
      product_items: [{ product_id: 1005001234567890, sku_attr: "14:193#Black;200007763:201336100", product_count: 2, logistics_service_name: "USPS" }],
    });
  });

  it("commande refusée : code d'erreur remonté", async () => {
    mockGateway(() => ({ aliexpress_trade_buy_placeorder_response: { result: { is_success: false, error_code: "B_DROPSHIPPER_DELIVERY_ADDRESS_VALIDATE_FAIL" } } }));
    await expect(
      createOrder(cfg, "S", { outOrderId: "x", address: { fullName: "a", address: "b", city: "c", province: "d", zip: "e", country: "US" }, items: [] }),
    ).rejects.toThrow("B_DROPSHIPPER_DELIVERY_ADDRESS_VALIDATE_FAIL");
  });

  it("suivi de commande : statut et numéro de suivi", async () => {
    mockGateway(() => ({
      aliexpress_trade_ds_order_get_response: {
        result: { order_status: "WAIT_BUYER_ACCEPT_GOODS", order_amount: { amount: "10.49", currency_code: "USD" }, logistics_info_list: { ae_order_logistics_info: [{ logistics_no: "9400111", logistics_service: "USPS" }] } },
      },
    }));
    expect(await getOrder(cfg, "S", "8199")).toEqual({ status: "WAIT_BUYER_ACCEPT_GOODS", amountUsd: 10.49, tracking: [{ number: "9400111", service: "USPS" }] });
  });
});
