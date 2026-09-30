/**
 * Publicité automatique de bout en bout (base de données et eBay simulés).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const mem = vi.hoisted(() => ({ listings: [] as Row[], setups: [] as Row[] }));

function match(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, cond]) => {
    const v = row[k];
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>;
      if ("in" in c) return (c.in as unknown[]).includes(v);
      if ("not" in c) return c.not === null ? v !== null && v !== undefined : v !== c.not;
    }
    return v === cond;
  });
}

vi.mock("@/lib/db", () => ({
  db: {
    listing: {
      findMany: vi.fn(async ({ where }: { where: Row }) => mem.listings.filter((l) => match(l, where)).map((l) => ({ ...l }))),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => Object.assign(mem.listings.find((l) => l.id === where.id)!, data)),
    },
    ebayMarketSetup: {
      findUnique: vi.fn(async ({ where }: { where: { ebayAccountId_marketplaceId: Row } }) => mem.setups.find((s) => match(s, where.ebayAccountId_marketplaceId)) ?? null),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => Object.assign(mem.setups.find((s) => s.id === where.id)!, data)),
    },
    ebayAccount: { update: vi.fn() },
  },
}));
vi.mock("@/lib/crypto", () => ({ decrypt: (s: string) => s, encrypt: (s: string) => s }));

import { syncAds } from "./ads-service";
import { MARKETING_SCOPE, LEGACY_SCOPES } from "./ebay";

type Call = { method: string; url: string; body?: unknown };
let calls: Call[] = [];
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });

function router(url: string, init?: RequestInit): Response {
  const p = new URL(url).pathname;
  const method = init?.method ?? "GET";
  if (p === "/sell/marketing/v1/ad_campaign" && method === "GET") return json({ campaigns: [] });
  if (p === "/sell/marketing/v1/ad_campaign" && method === "POST") return new Response(null, { status: 201, headers: { location: "https://api.ebay.com/sell/marketing/v1/ad_campaign/CAMP1" } });
  if (p.endsWith("/bulk_create_ads_by_listing_id")) {
    const body = JSON.parse(String(init?.body)) as { requests: { listingId: string }[] };
    return json({ responses: body.requests.map((r) => ({ listingId: r.listingId, adId: `AD-${r.listingId}`, statusCode: 201 })) });
  }
  if (p.endsWith("/update_bid")) return new Response(null, { status: 204 });
  if (method === "DELETE" && p.includes("/ad/")) return new Response(null, { status: 204 });
  return json({ errors: [{ message: `route inconnue ${url}` }] }, 500);
}

const scopes = [...LEGACY_SCOPES, MARKETING_SCOPE].join(" ");
const account = (s: string | null = scopes) => ({ id: "ACC", accessToken: "USER", accessTokenExpires: new Date(Date.now() + 3600_000), refreshToken: "R", refreshTokenExpires: new Date(Date.now() + 86400_000), scopes: s });
const user = (over: Row = {}) => ({ id: "U1", minMarginPct: 30, adsEnabled: true, adRateMax: 6, ebayAccounts: [account()], ...over }) as never;
const listing = (over: Row = {}): Row => ({
  id: "L1", userId: "U1", sku: "SKU1", status: "ACTIVE", ebayAccountId: "ACC", ebayListingId: "EB1", marketplace: "EBAY_US",
  price: 30.75, supplierCost: 11.45, adRate: null, adId: null, ...over,
});

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://x");
  vi.stubEnv("SESSION_SECRET", "x".repeat(32));
  vi.stubEnv("ENCRYPTION_KEY", "0".repeat(64));
  mem.listings = [listing()];
  mem.setups = [{ id: "SET1", ebayAccountId: "ACC", marketplaceId: "EBAY_US", adCampaignId: null }];
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return router(url, init);
  }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("publicité automatique", () => {
  it("crée la campagne une fois, promeut l'annonce au taux plafonné, garde la marge", async () => {
    const r = await syncAds(user());
    expect(r).toMatchObject({ created: 1, errors: 0 });
    expect(mem.setups[0].adCampaignId).toBe("CAMP1");
    const create = calls.find((c) => c.url.endsWith("/bulk_create_ads_by_listing_id"))!;
    expect(create.body).toEqual({ requests: [{ listingId: "EB1", bidPercentage: "6.0" }] });
    expect(mem.listings[0]).toMatchObject({ adId: "AD-EB1", adRate: 6 });
    calls = [];
    expect(await syncAds(user())).toMatchObject({ created: 0, updated: 0, removed: 0 }); // rien à changer
    expect(calls).toHaveLength(0);
  });

  it("coût en hausse : taux baissé ; plus rentable : publicité retirée ; désactivée : retirée", async () => {
    mem.setups[0].adCampaignId = "CAMP1";
    mem.listings = [listing({ adId: "AD1", adRate: 6, supplierCost: 16 })];
    const r = await syncAds(user());
    expect(r.updated).toBe(1);
    const newRate = mem.listings[0].adRate as number;
    expect(newRate).toBeLessThan(6);
    expect(newRate).toBeGreaterThanOrEqual(2);

    mem.listings[0].supplierCost = 19;
    expect((await syncAds(user())).removed).toBe(1);
    expect(mem.listings[0]).toMatchObject({ adId: null, adRate: null });

    mem.listings = [listing({ adId: "AD2", adRate: 5 })];
    expect((await syncAds(user({ adsEnabled: false }))).removed).toBe(1);
    expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/ad_campaign/CAMP1/ad/AD2"))).toBe(true);
  });

  it("compte sans autorisation publicité : ignoré (il faut reconnecter eBay)", async () => {
    const r = await syncAds(user({ ebayAccounts: [account(null)] }));
    expect(r).toMatchObject({ skipped: 1, created: 0 });
    expect(calls).toHaveLength(0);
  });
});
