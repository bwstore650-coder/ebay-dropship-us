/**
 * Test de bout en bout de la publication (base de données, CJ et eBay simulés) :
 * vérifie les appels envoyés à eBay et les refus (marge, marque protégée, réglages, Europe).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  setup: null as null | Record<string, string>,
  listedToday: 0,
  created: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/db", () => ({
  db: {
    ebayMarketSetup: { findUnique: vi.fn(async () => store.setup), upsert: vi.fn() },
    listing: {
      count: vi.fn(async () => store.listedToday),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        store.created.push(data);
        return { id: "LST1", ...data };
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        store.updates.push(data);
        return data;
      }),
    },
    ebayAccount: { update: vi.fn() },
  },
}));
vi.mock("@/lib/crypto", () => ({ decrypt: (s: string) => s, encrypt: (s: string) => s }));

import { ListingError, prepareListing, publishListing } from "./listing-service";

type Call = { method: string; url: string; body: unknown };
let calls: Call[] = [];
let aspects: unknown[] = [];

const parse = (b: unknown) => {
  try {
    return b ? JSON.parse(String(b)) : undefined;
  } catch {
    return String(b);
  }
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

function router(url: string, init?: RequestInit): Response {
  const u = new URL(url);
  const path = u.pathname;
  if (u.hostname === "developers.cjdropshipping.com") {
    if (path.endsWith("/product/query"))
      return json({
        code: 200, result: true, message: "ok",
        data: {
          pid: "P1", productNameEn: "Electric Can Opener", sellPrice: 8,
          productImage: '["https://cf.cj.com/1.jpg","http://cf.cj.com/2.jpg"]',
          description: "<p>Material: ABS</p><p>Power: 4 x AA</p>",
          variants: [{ vid: "V1", variantSku: "S1", variantKey: "White", variantSellPrice: 8, inventories: [{ countryCode: "US", totalInventory: 50 }, { countryCode: "DE", totalInventory: 20 }] }],
        },
      });
    if (path.endsWith("/logistic/freightCalculate"))
      return json({ code: 200, result: true, message: "ok", data: [{ logisticName: "CJPacket", logisticPrice: 4, logisticAging: "2-5" }] });
  }
  if (u.hostname === "api.frankfurter.dev") return json({ rates: { EUR: 0.9, CAD: 1.35, GBP: 0.78, AUD: 1.5 } });
  if (path === "/identity/v1/oauth2/token") return json({ access_token: "APP", expires_in: 7200, token_type: "Bearer" });
  if (path === "/buy/browse/v1/item_summary/search")
    return json({
      total: 3,
      itemSummaries: [
        { itemId: "1", title: "Automatic Can Opener Electric Smooth Edge", price: { value: "29.99", currency: "USD" }, leafCategoryIds: ["20667"] },
        { itemId: "2", title: "Electric Can Opener Hands Free", price: { value: "31.00", currency: "USD" }, leafCategoryIds: ["20667"] },
        { itemId: "3", title: "Can opener", price: { value: "25.00", currency: "USD" }, leafCategoryIds: ["11111"] },
      ],
    });
  if (path.endsWith("/get_default_category_tree_id")) return json({ categoryTreeId: "0" });
  if (path.endsWith("/get_item_aspects_for_category")) return json({ aspects });
  if (path.endsWith("/get_category_subtree")) return json({ categorySubtreeNode: { category: { categoryName: "Can Openers" } } });
  if (path.startsWith("/sell/inventory/v1/inventory_item/") && init?.method === "PUT") return new Response(null, { status: 204 });
  if (path === "/sell/inventory/v1/offer" && (init?.method ?? "GET") === "GET") return json({ errors: [{ errorId: 25713, message: "Not found" }] }, 404);
  if (path === "/sell/inventory/v1/offer" && init?.method === "POST") return json({ offerId: "O1" });
  if (path === "/sell/inventory/v1/offer/O1/publish") return json({ listingId: "L1" });
  return json({ errors: [{ message: `route inconnue ${url}` }] }, 500);
}

const user = (over: Record<string, unknown> = {}) =>
  ({
    id: "U1", plan: "PRO", minMarginPct: 30, ebayAccountOpenedAt: null,
    euRpCompany: null, euRpAddress: null, euRpCity: null, euRpPostalCode: null, euRpCountry: null, euRpEmail: null,
    ebayAccounts: [{ id: "A1", accessToken: "USER", accessTokenExpires: new Date(Date.now() + 3600_000), refreshToken: "R", refreshTokenExpires: new Date(Date.now() + 86400_000) }],
    supplierAccounts: [{ supplier: "CJ", accessToken: "CJTOKEN" }],
    ...over,
  }) as never;

const baseInput = {
  ebayAccountId: "A1",
  marketId: "EBAY_US" as const,
  ref: { supplier: "CJ" as const, productId: "P1", variantId: "V1" },
  categoryId: "20667",
  title: "Automatic Electric Can Opener Smooth Edge Hands Free",
  descriptionHtml: "<h3>Easy</h3><p>Opens any standard can without effort.</p>",
  aspects: { Type: ["electric"], "Power Source": ["Battery"] },
  price: 29.99,
  quantity: 3,
};

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://x");
  vi.stubEnv("SESSION_SECRET", "x".repeat(32));
  vi.stubEnv("ENCRYPTION_KEY", "0".repeat(64));
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  calls = [];
  store.setup = { fulfillmentPolicyId: "F1", paymentPolicyId: "PAY1", returnPolicyId: "R1", merchantLocationKey: "PL-US-90001" };
  store.listedToday = 0;
  store.created = [];
  store.updates = [];
  aspects = [
    { localizedAspectName: "Brand", aspectConstraint: { aspectRequired: true, aspectMode: "FREE_TEXT" }, aspectValues: [] },
    { localizedAspectName: "Type", aspectConstraint: { aspectRequired: true, aspectMode: "SELECTION_ONLY" }, aspectValues: [{ localizedValue: "Electric" }, { localizedValue: "Manual" }] },
    { localizedAspectName: "Power Source", aspectConstraint: { aspectRequired: true, aspectMode: "FREE_TEXT" }, aspectValues: [{ localizedValue: "Battery" }] },
  ];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", url, body: parse(init?.body) });
    return router(url, init);
  }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const find = (method: string, part: string) => calls.find((c) => c.method === method && c.url.includes(part));

describe("publication d'une annonce", { timeout: 30_000 }, () => {
  it("publie : fiche article, offre complète, publication, annonce enregistrée", async () => {
    const r = await publishListing(user(), baseInput);
    expect(r).toEqual({ id: "LST1", listingId: "L1", url: "https://www.ebay.com/itm/L1" });

    const item = find("PUT", "/sell/inventory/v1/inventory_item/")!;
    const body = item.body as { condition: string; product: { title: string; imageUrls: string[]; aspects: Record<string, string[]> }; availability: { shipToLocationAvailability: { quantity: number } } };
    expect(body.condition).toBe("NEW");
    expect(body.product.title).toBe(baseInput.title);
    expect(body.product.imageUrls).toEqual(["https://cf.cj.com/1.jpg", "https://cf.cj.com/2.jpg"]);
    expect(body.product.aspects).toEqual({ Brand: ["Unbranded"], Type: ["Electric"], "Power Source": ["Battery"] });
    expect(body.availability.shipToLocationAvailability.quantity).toBe(3);

    const offer = find("POST", "/sell/inventory/v1/offer")!.body as Record<string, unknown>;
    expect(offer).toMatchObject({
      marketplaceId: "EBAY_US", format: "FIXED_PRICE", listingDuration: "GTC", availableQuantity: 3, categoryId: "20667",
      merchantLocationKey: "PL-US-90001",
      pricingSummary: { price: { value: "29.99", currency: "USD" } },
      listingPolicies: { fulfillmentPolicyId: "F1", paymentPolicyId: "PAY1", returnPolicyId: "R1" },
    });
    expect(offer.regulatory).toBeUndefined(); // hors UE
    expect(find("POST", "/offer/O1/publish")).toBeTruthy();

    expect(store.created[0]).toMatchObject({ status: "DRAFT", marketplace: "EBAY_US", supplierCost: 12, price: 29.99, ebayAccountId: "A1" });
    expect(store.updates.at(-1)).toMatchObject({ status: "ACTIVE", ebayOfferId: "O1", ebayListingId: "L1" });
  });

  it("refuse un prix sous la marge minimum (prix minimum indiqué)", async () => {
    await expect(publishListing(user(), { ...baseInput, price: 17 })).rejects.toMatchObject({ code: "MARGIN_TOO_LOW" });
    expect(find("PUT", "inventory_item")).toBeUndefined();
  });

  it("refuse une marque protégée", async () => {
    await expect(publishListing(user(), { ...baseInput, title: "Apple style electric can opener" })).rejects.toMatchObject({ code: "LISTING_BLOCKED", detail: "apple" });
  });

  it("refuse si une caractéristique obligatoire manque", async () => {
    await expect(publishListing(user(), { ...baseInput, aspects: { Type: ["Electric"] } })).rejects.toMatchObject({ code: "ASPECTS_MISSING", detail: "Power Source" });
  });

  it("exige les réglages eBay du pays, et la limite du jour", async () => {
    store.setup = null;
    await expect(publishListing(user(), baseInput)).rejects.toMatchObject({ code: "EBAY_SETUP_REQUIRED" });
    store.setup = { fulfillmentPolicyId: "F1", paymentPolicyId: "PAY1", returnPolicyId: "R1", merchantLocationKey: "K" };
    store.listedToday = 5;
    await expect(publishListing(user(), baseInput)).rejects.toMatchObject({ code: "DAILY_LIMIT", detail: "5" });
  });

  it("Europe : personne responsable obligatoire, puis envoyée dans l'offre ; prix en euros", async () => {
    const eu = { ...baseInput, marketId: "EBAY_DE" as const, aspects: { Type: ["Electric"], "Power Source": ["Battery"] }, price: 29.9 };
    aspects = [
      { localizedAspectName: "Marke", aspectConstraint: { aspectRequired: true, aspectMode: "FREE_TEXT" }, aspectValues: [] },
      { localizedAspectName: "Type", aspectConstraint: { aspectRequired: true, aspectMode: "SELECTION_ONLY" }, aspectValues: [{ localizedValue: "Electric" }] },
      { localizedAspectName: "Power Source", aspectConstraint: { aspectRequired: false, aspectMode: "FREE_TEXT" }, aspectValues: [] },
    ];
    await expect(publishListing(user(), eu)).rejects.toMatchObject({ code: "GPSR_REQUIRED" });
    const rp = { euRpCompany: "RV EU GmbH", euRpAddress: "Str. 1", euRpCity: "Berlin", euRpPostalCode: "10115", euRpCountry: "DE", euRpEmail: "eu@x.com" };
    const r = await publishListing(user(rp), eu);
    expect(r.url).toBe("https://www.ebay.de/itm/L1");
    const offer = find("POST", "/sell/inventory/v1/offer")!.body as Record<string, unknown>;
    expect(offer).toMatchObject({
      marketplaceId: "EBAY_DE",
      pricingSummary: { price: { value: "29.90", currency: "EUR" } },
      regulatory: { responsiblePersons: [{ companyName: "RV EU GmbH", addressLine1: "Str. 1", city: "Berlin", postalCode: "10115", country: "DE", email: "eu@x.com", types: ["EUResponsiblePerson"] }] },
    });
    const item = find("PUT", "inventory_item")!.body as { product: { aspects: Record<string, string[]> } };
    expect(item.product.aspects.Marke).toEqual(["Markenlos"]);
    // Coût converti en euros avec 2 % de sécurité : (8 + 4) × 0,9 × 1,02 = 11,02 (8 → 7,34 ; 4 → 3,67)
    expect(store.created.at(-1)).toMatchObject({ currency: "EUR", supplierCost: 11.01 });
  });

  it("refus d'eBay : message lisible et annonce gardée en brouillon avec l'erreur", async () => {
    const f = globalThis.fetch as ReturnType<typeof vi.fn>;
    f.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? "GET", url, body: undefined });
      if (String(url).includes("/offer/O1/publish")) return json({ errors: [{ errorId: 25019, message: "Short", longMessage: "The item location is invalid." }] }, 400);
      return router(url, init);
    });
    const err = await publishListing(user(), baseInput).catch((e) => e);
    expect(err).toBeInstanceOf(ListingError);
    expect(err).toMatchObject({ code: "EBAY_REJECTED", detail: "The item location is invalid." });
    expect(store.updates.at(-1)).toEqual({ errorMessage: "The item location is invalid." });
  });
});

describe("préparation d'une annonce", { timeout: 30_000 }, () => {
  it("catégorie la plus fréquente, marque forcée, prix conseillé ≥ minimum, texte fournisseur sans IA", async () => {
    const d = await prepareListing(user(), { keyword: "electric can opener", marketId: "EBAY_US", ref: { supplier: "CJ", productId: "P1", variantId: "V1" } });
    expect(d.categoryId).toBe("20667");
    expect(d.categoryName).toBe("Can Openers");
    expect(d.copySource).toBe("supplier");
    expect(d.title).toBe("Electric Can Opener White");
    expect(d.descriptionHtml).toBe("<ul><li>Material: ABS</li><li>Power: 4 x AA</li></ul>");
    expect(d.aspects).toEqual({ Brand: ["Unbranded"] });
    expect(d.missingRequired).toEqual(["Type", "Power Source"]);
    expect(d.cost).toBe(12);
    expect(d.minPrice).toBeGreaterThan(12);
    expect(d.suggestedPrice).toBe(29.99); // médiane du marché, au-dessus du minimum
    expect(d.images).toHaveLength(2);
    expect(d.quantity).toBe(3);
  });

  it("refuse sans formule", async () => {
    await expect(prepareListing(user({ plan: "NONE" }), { keyword: "x y", marketId: "EBAY_US", ref: { supplier: "CJ", productId: "P1" } })).rejects.toMatchObject({ code: "PLAN_REQUIRED" });
  });
});
