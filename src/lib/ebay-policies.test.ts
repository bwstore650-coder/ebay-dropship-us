import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultPolicies, DEFAULT_POLICY_NAMES, parseShippingServices, pickShippingService } from "./ebay";

const svc = (code: string, o: { cat?: string; carrier?: string; max?: number; intl?: boolean; valid?: boolean; types?: string[] } = {}) =>
  `<ShippingServiceDetails><ShippingService>${code}</ShippingService><ShippingServiceID>1</ShippingServiceID>` +
  (o.intl ? "<InternationalService>true</InternationalService>" : "") +
  (o.carrier ? `<ShippingCarrier>${o.carrier}</ShippingCarrier>` : "") +
  (o.max ? `<ShippingTimeMax>${o.max}</ShippingTimeMax>` : "") +
  (o.types ?? ["Flat", "Calculated"]).map((t) => `<ServiceType>${t}</ServiceType>`).join("") +
  `<ValidForSellingFlow>${o.valid === false ? "false" : "true"}</ValidForSellingFlow>` +
  (o.cat ? `<ShippingCategory>${o.cat}</ShippingCategory>` : "") +
  "</ShippingServiceDetails>";

const XML = `<?xml version="1.0"?><GeteBayDetailsResponse><Ack>Success</Ack>${[
  svc("USPSPriority", { cat: "EXPEDITED", carrier: "USPS", max: 3 }),
  svc("UPSGround", { cat: "STANDARD", carrier: "UPS", max: 5 }),
  svc("ShippingMethodStandard", { cat: "STANDARD", max: 5 }),
  svc("OldStandard", { cat: "STANDARD", max: 4, valid: false }),
  svc("StandardInternational", { cat: "STANDARD", intl: true }),
  svc("FreightOnly", { cat: "STANDARD", types: ["Freight"] }),
  svc("LocalPickup", { cat: "PICKUP" }),
].join("")}</GeteBayDetailsResponse>`;

describe("service de livraison choisi pour la politique standard", () => {
  it("garde les services nationaux au forfait utilisables", () => {
    expect(parseShippingServices(XML).map((s) => s.code)).toEqual(["USPSPriority", "UPSGround", "ShippingMethodStandard", "LocalPickup"]);
  });
  it("standard, générique, puis le plus rapide", () => {
    expect(pickShippingService(parseShippingServices(XML))).toBe("ShippingMethodStandard");
    expect(pickShippingService(parseShippingServices(XML).filter((s) => s.code !== "ShippingMethodStandard"))).toBe("UPSGround");
    expect(pickShippingService(parseShippingServices(XML).filter((s) => s.category !== "STANDARD"))).toBe("USPSPriority");
    expect(pickShippingService([{ code: "LocalPickup", category: "PICKUP", carrier: null, maxDays: null }])).toBeNull();
  });
});

describe("création des politiques manquantes", () => {
  let calls: { url: string; method: string; body: Record<string, unknown> | null }[] = [];
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "postgresql://x");
    vi.stubEnv("SESSION_SECRET", "x".repeat(32));
    vi.stubEnv("ENCRYPTION_KEY", "0".repeat(64));
    vi.stubEnv("EBAY_ENV", "sandbox");
    calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body && String(init.body).startsWith("{") ? JSON.parse(String(init.body)) : null });
      if (url.endsWith("/ws/api.dll")) return new Response(XML, { status: 200 });
      return new Response(JSON.stringify({ id: "P" }), { status: 201 });
    }));
  });

  it("crée seulement ce qui manque, avec la livraison gratuite et les retours 30 jours", async () => {
    await createDefaultPolicies("TOKEN", "EBAY_US", { fulfillment: true, payment: false, returns: true });
    const posts = calls.filter((c) => c.method === "POST" && !c.url.endsWith("/ws/api.dll"));
    expect(posts.map((c) => new URL(c.url).pathname)).toEqual(["/sell/account/v1/fulfillment_policy", "/sell/account/v1/return_policy"]);
    expect(posts[0].body).toMatchObject({
      name: DEFAULT_POLICY_NAMES.fulfillment,
      marketplaceId: "EBAY_US",
      handlingTime: { value: 3, unit: "DAY" },
      shippingOptions: [{ optionType: "DOMESTIC", costType: "FLAT_RATE", shippingServices: [{ shippingServiceCode: "ShippingMethodStandard", freeShipping: true, shippingCost: { value: "0.00", currency: "USD" } }] }],
    });
    expect(posts[1].body).toMatchObject({ returnsAccepted: true, returnPeriod: { value: 30, unit: "DAY" }, returnShippingCostPayer: "BUYER" });
    expect(calls.every((c) => c.url.startsWith("https://api.sandbox.ebay.com"))).toBe(true);
  });

  it("devise du pays et paiement immédiat", async () => {
    await createDefaultPolicies("TOKEN", "EBAY_GB", { fulfillment: true, payment: true, returns: false });
    const posts = calls.filter((c) => c.method === "POST" && !c.url.endsWith("/ws/api.dll"));
    expect((posts[0].body as { shippingOptions: { shippingServices: { shippingCost: { currency: string } }[] }[] }).shippingOptions[0].shippingServices[0].shippingCost.currency).toBe("GBP");
    expect(posts[1].body).toMatchObject({ name: DEFAULT_POLICY_NAMES.payment, immediatePay: true, marketplaceId: "EBAY_GB" });
  });
});
