/**
 * Test de bout en bout des commandes automatiques (base de données, eBay et CJ simulés).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const mem = vi.hoisted(() => ({ orders: [] as Row[], listings: [] as Row[], variants: [] as Row[], seq: 0 }));

/** Filtre minimal façon Prisma : égalité, { in }, { not: null }, { lt }, { gte }. */
function match(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (k === "OR") return (cond as Row[]).some((c) => match(row, c));
    const v = row[k] ?? (k.startsWith("msg") ? (k === "msgFailures" ? 0 : null) : row[k]);
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>;
      if ("in" in c) return (c.in as unknown[]).includes(v);
      if ("not" in c) return c.not === null ? v !== null && v !== undefined : v !== c.not;
      if ("lt" in c) return typeof v === "number" ? v < (c.lt as number) : v instanceof Date && v < (c.lt as Date);
      if ("gte" in c) return v instanceof Date && v >= (c.gte as Date);
      if ("gt" in c) return v instanceof Date && v > (c.gt as Date);
    }
    return v === cond;
  });
}
function apply(row: Row, data: Row) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && "increment" in (v as Row)) row[k] = ((row[k] as number) ?? 0) + ((v as Row).increment as number);
    else row[k] = v;
  }
  row.updatedAt = new Date();
}

vi.mock("@/lib/db", () => ({
  db: {
    listing: {
      findMany: vi.fn(async ({ where }: { where: Row }) => mem.listings.filter((l) => match(l, where))),
      findUnique: vi.fn(async ({ where }: { where: Row }) => mem.listings.find((l) => match(l, where)) ?? null),
    },
    listingVariant: {
      findMany: vi.fn(async ({ where }: { where: { sku: { in: string[] }; listing: { userId: string } } }) =>
        mem.variants
          .filter((v) => where.sku.in.includes(v.sku as string))
          .map((v) => ({ ...v, listing: mem.listings.find((l) => l.id === v.listingId && l.userId === where.listing.userId) }))
          .filter((v) => v.listing)),
    },
    order: {
      findMany: vi.fn(async ({ where }: { where: Row }) => mem.orders.filter((o) => match(o, where))),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: Row }) => {
        const o = mem.orders.find((x) => match(x, where));
        if (!o) throw new Error("not found");
        return { ...o };
      }),
      count: vi.fn(async ({ where }: { where: Row }) => mem.orders.filter((o) => match(o, where)).length),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = { id: `O${++mem.seq}`, status: "PENDING", attempts: 0, supplierOrderId: null, orderedAt: null, createdAt: new Date(), updatedAt: new Date(), ...data };
        mem.orders.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const o = mem.orders.find((x) => match(x, where))!;
        apply(o, data);
        return o;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const rows = mem.orders.filter((x) => match(x, where));
        rows.forEach((r) => apply(r, data));
        return { count: rows.length };
      }),
    },
    ebayAccount: { update: vi.fn() },
    user: { update: vi.fn() },
    afterSale: { count: vi.fn(async () => 0), upsert: vi.fn(), updateMany: vi.fn() },
  },
}));
vi.mock("@/lib/crypto", () => ({ decrypt: (s: string) => s, encrypt: (s: string) => s }));

import { importOrders, placeOrder, runForUser, syncTracking } from "./order-service";
import { planInfo } from "./plans";

type Call = { method: string; url: string; body: unknown };
let calls: Call[] = [];
let cjCreate: () => Response;
let cjStock = 50;
let variantPrice = 8;
let ebayOrderOverride: Record<string, unknown> = {};

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const cj = (data: unknown) => json({ code: 200, result: true, message: "ok", data });
const parse = (b: unknown) => {
  try {
    return b ? JSON.parse(String(b)) : undefined;
  } catch {
    return String(b);
  }
};

const ebayOrder = (id: string, sku: string, extra: Record<string, unknown> = {}) => ({
  orderId: id,
  creationDate: "2026-09-27T10:00:00.000Z",
  orderFulfillmentStatus: "NOT_STARTED",
  orderPaymentStatus: "PAID",
  cancelStatus: { cancelState: "NONE_REQUESTED" },
  pricingSummary: { total: { value: "30.75", currency: "USD" } },
  lineItems: [{ lineItemId: `LI-${id}`, legacyItemId: `ITEM-${id}`, sku, quantity: 1, title: "Electric Can Opener" }],
  buyer: { username: `buyer-${id}` },
  fulfillmentStartInstructions: [{ shippingStep: { shipTo: { fullName: "Jane Doe", primaryPhone: { phoneNumber: "555-123-4567" }, contactAddress: { addressLine1: "1 Main St", city: "Austin", stateOrProvince: "TX", postalCode: "73301", countryCode: "US" } } } }],
  ...extra,
});

function router(url: string): Response {
  const u = new URL(url);
  const p = u.pathname;
  if (u.hostname === "developers.cjdropshipping.com") {
    if (p.endsWith("/product/query"))
      return cj({ pid: "P1", productNameEn: "Can opener", sellPrice: variantPrice, variants: [{ vid: "V1", variantSku: "S", variantSellPrice: variantPrice, inventories: [{ countryCode: "US", totalInventory: cjStock }] }] });
    if (p.endsWith("/logistic/freightCalculate")) return cj([{ logisticName: "CJPacket US", logisticPrice: 3.45, logisticAging: "2-5" }]);
    if (p.endsWith("/shopping/order/createOrderV2")) return cjCreate();
    if (p.endsWith("/shopping/order/getOrderDetail")) return cj({ orderId: "CJ1", orderStatus: "SHIPPED", trackNumber: "9400111899223345678901", logisticName: "CJPacket US" });
  }
  if (p === "/identity/v1/oauth2/token") return json({ access_token: "APP", expires_in: 7200 });
  if (p === "/sell/fulfillment/v1/order")
    return json({ total: 3, orders: [ebayOrder("A-1", "PL-OURS"), ebayOrder("A-2", "SOMEONE-ELSE"), { ...ebayOrder("A-3", "PL-OURS"), lineItems: [{ lineItemId: "x", sku: "PL-OURS", quantity: 1, title: "Can opener" }, { lineItemId: "y", sku: "MANUAL", quantity: 1, title: "Old stock" }] }] });
  if (p.startsWith("/sell/fulfillment/v1/order/") && p.endsWith("/shipping_fulfillment")) return json({}, 201);
  if (p === "/ws/api.dll") return new Response("<AddMemberMessageAAQToPartnerResponse><Ack>Success</Ack></AddMemberMessageAAQToPartnerResponse>", { status: 200 });
  if (p.startsWith("/sell/fulfillment/v1/order/")) return json({ ...ebayOrder(decodeURIComponent(p.split("/").pop()!), "PL-OURS"), ...ebayOrderOverride });
  return json({ errors: [{ message: `route inconnue ${url}` }] }, 500);
}

const account = { id: "ACC", accessToken: "USER", accessTokenExpires: new Date(Date.now() + 3600_000), refreshToken: "R", refreshTokenExpires: new Date(Date.now() + 86400_000) };
const user = (over: Record<string, unknown> = {}) =>
  ({ id: "U1", plan: "PRO", autoOrder: true, ebayAccounts: [account], supplierAccounts: [{ supplier: "CJ", accessToken: "CJT" }], ...over }) as never;

const find = (method: string, part: string) => calls.find((c) => c.method === method && c.url.includes(part));

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://x");
  vi.stubEnv("SESSION_SECRET", "x".repeat(32));
  vi.stubEnv("ENCRYPTION_KEY", "0".repeat(64));
  mem.orders = [];
  mem.variants = [];
  mem.listings = [{ id: "LST", userId: "U1", sku: "PL-OURS", supplierVariantId: "V1", supplier: "CJ", supplierProductId: "P1", marketplace: "EBAY_US", currency: "USD" }];
  calls = [];
  cjStock = 50;
  variantPrice = 8;
  ebayOrderOverride = {};
  cjCreate = () => cj({ orderId: "CJ1", orderAmount: 11.45, orderStatus: "UNSHIPPED" });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", url, body: parse(init?.body) });
    return router(url);
  }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("commandes automatiques", { timeout: 60_000 }, () => {
  it("import : nos ventes seulement ; commande mixte à vérifier ; pas de doublon au 2e passage", async () => {
    expect(await importOrders(user(), account)).toBe(2);
    const a1 = mem.orders.find((o) => o.ebayOrderId === "A-1")!;
    expect(a1).toMatchObject({ status: "PENDING", saleTotal: 30.75, marketplace: "EBAY_US", listingId: "LST", ebayAccountId: "ACC" });
    expect(a1.lines).toEqual([{ lineItemId: "LI-A-1", sku: "PL-OURS", quantity: 1, listingId: "LST", supplier: "CJ", productId: "P1", vid: "V1", title: "Electric Can Opener", legacyItemId: "ITEM-A-1" }]);
    expect(a1).toMatchObject({ buyerUsername: "buyer-A-1", buyerName: "Jane" });
    expect(mem.orders.find((o) => o.ebayOrderId === "A-2")).toBeUndefined();
    expect(mem.orders.find((o) => o.ebayOrderId === "A-3")).toMatchObject({ status: "NEEDS_REVIEW", errorCode: "NOT_OURS", errorMessage: "Old stock" });
    // Filtre eBay : commandes à expédier des 30 derniers jours.
    const q = new URL(find("GET", "/sell/fulfillment/v1/order?")!.url).searchParams.get("filter")!;
    expect(q).toMatch(/^creationdate:\[\d{4}-\d{2}-\d{2}T.*Z\.\.\],orderfulfillmentstatus:\{NOT_STARTED\|IN_PROGRESS\}$/);
    expect(await importOrders(user(), account)).toBe(0);
    expect(mem.orders).toHaveLength(2);
  });

  it("import : vente d'une annonce créée sur eBay puis liée (retrouvée par son numéro d'annonce)", async () => {
    mem.listings.push({ id: "EXT", userId: "U1", sku: "EXT-ITEM-A-2", legacy: true, ebayListingId: "ITEM-A-2", status: "ACTIVE", supplierVariantId: "V2", supplier: "CJ", supplierProductId: "P2", marketplace: "EBAY_US", currency: "USD" });
    expect(await importOrders(user(), account)).toBe(3);
    const a2 = mem.orders.find((o) => o.ebayOrderId === "A-2")!;
    expect(a2).toMatchObject({ status: "PENDING", listingId: "EXT" });
    expect(a2.lines).toEqual([{ lineItemId: "LI-A-2", sku: "SOMEONE-ELSE", quantity: 1, listingId: "EXT", supplier: "CJ", productId: "P2", vid: "V2", title: "Electric Can Opener", legacyItemId: "ITEM-A-2" }]);
  });

  it("import : vente d'une variante (taille / quantité) d'une annonce à variantes", async () => {
    mem.listings.push({ id: "GRP", userId: "U1", sku: "PL-GRP", groupKey: "PL-GRP", supplierVariantId: "V1", supplier: "CJ", supplierProductId: "P9", marketplace: "EBAY_US", currency: "USD" });
    mem.variants.push({ id: "VAR2", listingId: "GRP", sku: "SOMEONE-ELSE", supplierVariantId: "V9-L" });
    expect(await importOrders(user(), account)).toBe(3);
    const a2 = mem.orders.find((o) => o.ebayOrderId === "A-2")!;
    expect(a2).toMatchObject({ status: "PENDING", listingId: "GRP" });
    expect(a2.lines).toEqual([{ lineItemId: "LI-A-2", sku: "SOMEONE-ELSE", quantity: 1, listingId: "GRP", supplier: "CJ", productId: "P9", vid: "V9-L", title: "Electric Can Opener", legacyItemId: "ITEM-A-2" }]);
  });

  it("import : variante d'une annonce d'un autre utilisateur ignorée", async () => {
    mem.listings.push({ id: "OTHER", userId: "U2", sku: "PL-X", supplier: "CJ", supplierProductId: "P9", marketplace: "EBAY_US", currency: "USD" });
    mem.variants.push({ id: "VARX", listingId: "OTHER", sku: "SOMEONE-ELSE", supplierVariantId: "V9-L" });
    expect(await importOrders(user(), account)).toBe(2);
  });

  it("import : une annonce liée puis plus gérée (terminée) ne déclenche plus de commande", async () => {
    mem.listings.push({ id: "EXT", userId: "U1", sku: "EXT-ITEM-A-2", legacy: true, ebayListingId: "ITEM-A-2", status: "ENDED", supplierVariantId: "V2", supplier: "CJ", supplierProductId: "P2", marketplace: "EBAY_US", currency: "USD" });
    expect(await importOrders(user(), account)).toBe(2);
    expect(mem.orders.find((o) => o.ebayOrderId === "A-2")).toBeUndefined();
  });

  it("commande chez CJ : adresse relue chez eBay, numéro unique, paiement par solde, profit enregistré", async () => {
    await importOrders(user(), account);
    const id = mem.orders.find((o) => o.ebayOrderId === "A-1")!.id as string;
    expect(await placeOrder(user(), id)).toBe("ORDERED");
    const body = find("POST", "createOrderV2")!.body as Record<string, unknown>;
    expect(body).toMatchObject({
      orderNumber: "EB-A-1", logisticName: "CJPacket US", payType: 2, fromCountryCode: "US", shippingCountryCode: "US",
      shippingCustomerName: "Jane Doe", shippingAddress: "1 Main St", shippingCity: "Austin", shippingProvince: "TX", shippingZip: "73301", shippingPhone: "5551234567",
      products: [{ vid: "V1", quantity: 1 }],
    });
    // 30,75 − (8 + 3,45) − 4,58 = 14,72
    expect(mem.orders.find((o) => o.id === id)).toMatchObject({ status: "ORDERED", supplierOrderId: "CJ1", supplierCost: 11.45, fees: 4.58, profit: 14.72 });
    // Déjà commandée : un 2e passage ne recommande pas.
    expect(await placeOrder(user(), id)).toBe("SKIPPED");
    expect(calls.filter((c) => c.url.includes("createOrderV2"))).toHaveLength(1);
  });

  it("vente à perte : rien n'est commandé sans accord ; « commander quand même » passe la commande", async () => {
    variantPrice = 30;
    await importOrders(user(), account);
    const id = mem.orders.find((o) => o.ebayOrderId === "A-1")!.id as string;
    expect(await placeOrder(user(), id)).toBe("LOSS");
    expect(find("POST", "createOrderV2")).toBeUndefined();
    expect(mem.orders.find((o) => o.id === id)).toMatchObject({ status: "NEEDS_REVIEW", errorCode: "LOSS", profit: -7.28 });
    expect(await placeOrder(user(), id, { force: true })).toBe("ORDERED");
  });

  it("rupture, solde CJ insuffisant, commande annulée entre-temps", async () => {
    await importOrders(user(), account);
    const id = mem.orders.find((o) => o.ebayOrderId === "A-1")!.id as string;
    cjStock = 0;
    expect(await placeOrder(user(), id)).toBe("OUT_OF_STOCK");
    cjStock = 50;
    cjCreate = () => json({ code: 1600100, result: false, message: "Insufficient balance", data: null });
    expect(await placeOrder(user(), id, { force: true })).toBe("CJ_BALANCE");
    expect(mem.orders.find((o) => o.id === id)).toMatchObject({ status: "FAILED", errorCode: "CJ_BALANCE" });
    ebayOrderOverride = { cancelStatus: { cancelState: "CANCEL_REQUESTED" } };
    expect(await placeOrder(user(), id, { force: true })).toBe("CANCELLED_BY_BUYER");
    expect(mem.orders.find((o) => o.id === id)!.status).toBe("CANCELLED");
  });

  it("quota mensuel de la formule", async () => {
    await importOrders(user(), account);
    for (let i = 0; i < planInfo("PRO")!.autoOrdersPerMonth!; i++) mem.orders.push({ id: `X${i}`, userId: "U1", status: "SHIPPED", orderedAt: new Date() });
    const id = mem.orders.find((o) => o.ebayOrderId === "A-1")!.id as string;
    expect(await placeOrder(user(), id)).toBe("PLAN_LIMIT_ORDERS");
  });

  it("suivi : numéro CJ renvoyé à eBay avec le bon transporteur, commande expédiée", async () => {
    await importOrders(user(), account);
    const id = mem.orders.find((o) => o.ebayOrderId === "A-1")!.id as string;
    await placeOrder(user(), id);
    expect(await syncTracking(user())).toBe(1);
    const f = find("POST", "/shipping_fulfillment")!;
    expect(f.url).toContain("/sell/fulfillment/v1/order/A-1/shipping_fulfillment");
    expect(f.body).toMatchObject({ lineItems: [{ lineItemId: "LI-A-1", quantity: 1 }], shippingCarrierCode: "USPS", trackingNumber: "9400111899223345678901" });
    expect(mem.orders.find((o) => o.id === id)).toMatchObject({ status: "SHIPPED", carrier: "USPS", trackingNumber: "9400111899223345678901" });
  });

  it("cycle complet ; commande automatique désactivée = rien n'est commandé", async () => {
    const off = await runForUser(user({ autoOrder: false }));
    expect(off).toMatchObject({ imported: 2, ordered: 0 });
    expect(find("POST", "createOrderV2")).toBeUndefined();
    mem.orders = [];
    const on = await runForUser(user());
    expect(on).toMatchObject({ imported: 2, ordered: 1, shipped: 1 });
  });

  it("messages automatiques : remerciement puis suivi, dans la langue du site ; rien si désactivés", async () => {
    await runForUser(user());
    expect(calls.filter((c) => c.url.includes("/ws/api.dll"))).toHaveLength(0); // désactivés par défaut
    mem.orders = [];
    calls = [];
    const r = await runForUser(user({ msgThanks: true, msgShipped: true, msgFeedback: true, feedbackDelayDays: 7, ebayAccounts: [{ ...account, ebayUserId: "bawa-store" }] }));
    expect(r.messages).toBe(1); // A-1 : remerciement (le suivi partira au passage suivant) ; A-3 : ligne sans numéro d'annonce eBay
    const sent = calls.filter((c) => c.url.includes("/ws/api.dll")).map((c) => String(c.body));
    expect(sent[0]).toContain("<RecipientID>buyer-A-1</RecipientID>");
    expect(sent[0]).toContain("<ItemID>ITEM-A-1</ItemID>");
    expect(sent[0]).toContain("Hi Jane,");
    expect(sent[0]).toContain("bawa-store");
    const a1 = mem.orders.find((o) => o.ebayOrderId === "A-1")!;
    expect(a1.msgThanksAt).toBeInstanceOf(Date);
    // Passage suivant : A-1 est expédiée → message de suivi avec le numéro.
    calls = [];
    await runForUser(user({ msgThanks: true, msgShipped: true, msgFeedback: true, feedbackDelayDays: 7, ebayAccounts: [{ ...account, ebayUserId: "bawa-store" }] }));
    const shipMsg = calls.filter((c) => c.url.includes("/ws/api.dll")).map((c) => String(c.body)).find((b) => b.includes("buyer-A-1"))!;
    expect(shipMsg).toContain("9400111899223345678901");
    expect(mem.orders.find((o) => o.ebayOrderId === "A-1")!.msgShippedAt).toBeInstanceOf(Date);
  });

  it("commande bloquée « en cours » depuis plus de 30 min : à vérifier, jamais recommandée", async () => {
    mem.orders.push({ id: "S1", userId: "U1", status: "ORDERING", ebayOrderId: "Z", updatedAt: new Date(Date.now() - 3600_000) });
    await runForUser(user({ ebayAccounts: [] }));
    expect(mem.orders.find((o) => o.id === "S1")).toMatchObject({ status: "NEEDS_REVIEW", errorCode: "STUCK" });
  });
});
