/**
 * Test de bout en bout de la surveillance (base de données, eBay et CJ simulés).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const mem = vi.hoisted(() => ({ listings: [] as Row[] }));

function match(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (k === "OR") return (cond as Row[]).some((c) => match(row, c));
    const v = row[k];
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>;
      if ("in" in c) return (c.in as unknown[]).includes(v);
      if ("not" in c) return c.not === null ? v !== null && v !== undefined : v !== c.not;
      if ("lt" in c) return v instanceof Date && v < (c.lt as Date);
    }
    return v === cond;
  });
}

vi.mock("@/lib/db", () => ({
  db: {
    listing: {
      findMany: vi.fn(async ({ where }: { where: Row }) => mem.listings.filter((l) => match(l, where)).map((l) => ({ ...l }))),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const l = mem.listings.find((x) => x.id === where.id)!;
        Object.assign(l, data);
        return l;
      }),
    },
    ebayAccount: { update: vi.fn() },
  },
}));
vi.mock("@/lib/crypto", () => ({ decrypt: (s: string) => s, encrypt: (s: string) => s }));

import { monitorUser } from "./monitor-service";

type Call = { method: string; url: string; body: unknown };
let calls: Call[] = [];
let ebayFailSku: string | null = null;

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const cjOk = (data: unknown) => json({ code: 200, result: true, message: "ok", data });
const cjErr = (message: string) => json({ code: 1600000, result: false, message, data: null });

/** Produits CJ : P-OK (stock 50, 8 $), P-OUT (stock 0), P-GONE (retiré), P-DOWN (panne), P-UP (coût monté à 14 $). */
function router(url: string, init?: RequestInit): Response {
  const u = new URL(url);
  if (u.hostname === "developers.cjdropshipping.com") {
    if (u.pathname.endsWith("/product/query")) {
      const pid = u.searchParams.get("pid")!;
      if (pid === "P-GONE") return cjErr("Product does not exist");
      if (pid === "P-DOWN") return cjErr("System busy, try later");
      const stock = pid === "P-OUT" ? 0 : pid === "P-LOW" ? 2 : 50;
      const price = pid === "P-UP" ? 14 : 8;
      return cjOk({ pid, productNameEn: pid, sellPrice: price, variants: [{ vid: `V-${pid}`, variantSku: "S", variantSellPrice: price, inventories: [{ countryCode: "US", totalInventory: stock }, { countryCode: "DE", totalInventory: stock }] }] });
    }
    if (u.pathname.endsWith("/logistic/freightCalculate")) return cjOk([{ logisticName: "CJPacket", logisticPrice: 3.45, logisticAging: "2-5" }]);
  }
  if (u.hostname === "api.frankfurter.dev") return json({ rates: { EUR: 0.9, CAD: 1.35, GBP: 0.78, AUD: 1.5 } });
  if (u.pathname === "/sell/inventory/v1/bulk_update_price_quantity") {
    const body = JSON.parse(String(init?.body)) as { requests: { sku: string; offers: { offerId: string }[] }[] };
    return json({
      responses: body.requests.map((r) =>
        r.sku === ebayFailSku
          ? { sku: r.sku, offerId: r.offers[0].offerId, statusCode: 400, errors: [{ errorId: 25001, message: "Listing ended" }] }
          : { sku: r.sku, offerId: r.offers[0].offerId, statusCode: 200 },
      ),
    });
  }
  return json({ errors: [{ message: `route inconnue ${url}` }] }, 500);
}

const listing = (id: string, pid: string, over: Row = {}): Row => ({
  id, userId: "U1", sku: `SKU-${id}`, status: "ACTIVE", supplier: "CJ", supplierProductId: pid, supplierVariantId: `V-${pid}`,
  ebayOfferId: `OF-${id}`, ebayAccountId: "ACC", marketplace: "EBAY_US", currency: "USD", price: 30.75, quantity: 3,
  lastCheckedAt: null, pauseReason: null, pauseDetail: null, errorMessage: null, ...over,
});

const user = () =>
  ({
    id: "U1", plan: "PRO", minMarginPct: 30,
    ebayAccounts: [{ id: "ACC", accessToken: "USER", accessTokenExpires: new Date(Date.now() + 3600_000), refreshToken: "R", refreshTokenExpires: new Date(Date.now() + 86400_000) }],
    supplierAccounts: [{ supplier: "CJ", accessToken: "CJT" }],
  }) as never;

const get = (id: string) => mem.listings.find((l) => l.id === id)!;

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://x");
  vi.stubEnv("SESSION_SECRET", "x".repeat(32));
  vi.stubEnv("ENCRYPTION_KEY", "0".repeat(64));
  calls = [];
  ebayFailSku = null;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return router(url, init);
  }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("surveillance du stock et des prix", { timeout: 60_000 }, () => {
  it("pause, reprise, quantité ajustée, panne ignorée : un seul envoi groupé à eBay", async () => {
    mem.listings = [
      listing("OK", "P-OK"),
      listing("OUT", "P-OUT"),
      listing("BACK", "P-OK", { status: "PAUSED", pauseReason: "OUT_OF_STOCK", supplierVariantId: "V-P-OK" }),
      listing("UP", "P-UP"),
      listing("GONE", "P-GONE"),
      listing("DOWN", "P-DOWN"),
      listing("LOW", "P-LOW"),
      listing("DE", "P-OK", { marketplace: "EBAY_DE", currency: "EUR", price: 29.9 }),
    ];
    const r = await monitorUser(user());
    expect(r).toEqual({ checked: 7, paused: 3, resumed: 1, updated: 1, errors: 1 });

    const bulk = calls.filter((c) => c.url.includes("bulk_update_price_quantity"));
    expect(bulk).toHaveLength(1);
    const reqs = (bulk[0].body as { requests: { sku: string; shipToLocationAvailability: { quantity: number }; offers: { offerId: string; availableQuantity: number }[] }[] }).requests;
    const bySku = Object.fromEntries(reqs.map((x) => [x.sku, x]));
    expect(bySku["SKU-OUT"]).toEqual({ sku: "SKU-OUT", shipToLocationAvailability: { quantity: 0 }, offers: [{ offerId: "OF-OUT", availableQuantity: 0 }] });
    expect(bySku["SKU-BACK"].offers[0].availableQuantity).toBe(3);
    expect(bySku["SKU-LOW"].offers[0].availableQuantity).toBe(2);
    expect(bySku["SKU-OK"]).toBeUndefined(); // rien à changer
    expect(bySku["SKU-DOWN"]).toBeUndefined(); // panne CJ : on ne touche à rien

    expect(get("OUT")).toMatchObject({ status: "PAUSED", pauseReason: "OUT_OF_STOCK" });
    expect(get("GONE")).toMatchObject({ status: "PAUSED", pauseReason: "SUPPLIER_GONE" });
    // 30,75 − (14 + 3,45) − 4,58 = 8,72 → 28,4 % < 30 % ; prix minimum conseillé > 30,75
    expect(get("UP")).toMatchObject({ status: "PAUSED", pauseReason: "MARGIN", lastMarginPct: 28.4, supplierCost: 17.45 });
    expect(Number(get("UP").pauseDetail)).toBeGreaterThan(30.75);
    expect(get("BACK")).toMatchObject({ status: "ACTIVE", quantity: 3, pauseReason: null });
    expect(get("LOW")).toMatchObject({ status: "ACTIVE", quantity: 2 });
    expect(get("OK")).toMatchObject({ status: "ACTIVE", lastMarginPct: 47.9 });
    expect(get("OK").lastCheckedAt).toBeInstanceOf(Date);
    expect(get("DOWN").lastCheckedAt).toBeNull(); // sera revérifiée au prochain passage
    // Allemagne : coût converti en euros (8 × 0,9 × 1,02 = 7,34 ; 3,45 → 3,17) = 10,51
    expect(get("DE")).toMatchObject({ status: "ACTIVE", supplierCost: 10.51 });

    // Un seul appel « fiche produit » pour P-OK malgré 3 annonces.
    expect(calls.filter((c) => c.url.includes("pid=P-OK"))).toHaveLength(1);
  });

  it("annonces vérifiées il y a moins d'une heure : ignorées, sauf vérification forcée", async () => {
    mem.listings = [listing("OK", "P-OK", { lastCheckedAt: new Date() })];
    expect((await monitorUser(user())).checked).toBe(0);
    expect((await monitorUser(user(), { force: true })).checked).toBe(1);
  });

  it("refus d'eBay pour une annonce : erreur enregistrée, statut inchangé", async () => {
    mem.listings = [listing("OUT", "P-OUT")];
    ebayFailSku = "SKU-OUT";
    const r = await monitorUser(user());
    expect(r).toMatchObject({ paused: 0, errors: 1 });
    expect(get("OUT")).toMatchObject({ status: "ACTIVE", errorMessage: "Listing ended" });
  });

  it("déjà en pause et toujours en rupture : pas d'appel eBay", async () => {
    mem.listings = [listing("OUT", "P-OUT", { status: "PAUSED", pauseReason: "OUT_OF_STOCK" })];
    await monitorUser(user());
    expect(calls.some((c) => c.url.includes("bulk_update"))).toBe(false);
    expect(get("OUT").lastCheckedAt).toBeInstanceOf(Date);
  });
});
