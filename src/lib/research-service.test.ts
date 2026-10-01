/**
 * Recherche marché de bout en bout (base de données et eBay simulés).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const mem = vi.hoisted(() => ({ cache: new Map<string, Row>(), trends: [] as Row[], seq: 0 }));

vi.mock("@/lib/db", () => ({
  db: {
    researchCache: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => mem.cache.get(where.key) ?? null),
      upsert: vi.fn(async ({ where, create }: { where: { key: string }; create: Row }) => {
        mem.cache.set(where.key, { ...create, createdAt: new Date() });
      }),
    },
    trendItem: {
      findMany: vi.fn(async ({ where }: { where: Row }) =>
        mem.trends.filter((t) => t.marketplace === where.marketplace && (!where.itemId || ((where.itemId as { in: string[] }).in).includes(t.itemId as string)) && (!where.niche || t.niche === where.niche)),
      ),
      upsert: vi.fn(async ({ where, create, update }: { where: { marketplace_itemId: { marketplace: string; itemId: string } }; create: Row; update: Row }) => {
        const k = where.marketplace_itemId;
        const row = mem.trends.find((t) => t.marketplace === k.marketplace && t.itemId === k.itemId);
        if (row) Object.assign(row, update, { updatedAt: new Date() });
        else mem.trends.push({ id: `t${++mem.seq}`, ...create, updatedAt: new Date() });
      }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    user: { findMany: vi.fn(async () => [{ defaultMarketplace: "EBAY_DE" }, { defaultMarketplace: "EBAY_US" }]) },
  },
}));

import { analyzeTitles, trendMarkets } from "./research-service";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
let sold: Record<string, number> = {};
let browseCalls = 0;

const summary = (id: string, title: string, price: string) => ({
  itemId: id, title, price: { value: price, currency: "USD" }, leafCategoryIds: ["20667"], itemWebUrl: `https://ebay.com/itm/${id}`,
  seller: { username: "bestdeals", feedbackScore: 5230, feedbackPercentage: "99.1" },
});

function router(url: string): Response {
  const u = new URL(url);
  const p = u.pathname;
  if (p === "/identity/v1/oauth2/token") return json({ access_token: "APP", expires_in: 7200 });
  if (p === "/buy/browse/v1/item_summary/search") {
    browseCalls++;
    const cat = u.searchParams.get("category_ids");
    const filter = u.searchParams.get("filter") ?? "";
    if (filter.includes("sellers:{bestdeals}")) {
      if (cat && cat !== "11700") return json({ errors: [{ errorId: 12001, message: "Invalid category" }] }, 400);
      return json({ total: 3, itemSummaries: [summary("v1|1|0", "Electric Can Opener Automatic", "30.00"), summary("v1|2|0", "Can Opener Manual Steel", "10.00"), summary("v1|3|0", "Garlic Press", "8.00")] });
    }
    if (cat) return json({ total: 2, itemSummaries: [summary(`v1|${cat}1|0`, `Top ${cat} product`, "20.00"), summary(`v1|${cat}2|0`, `Second ${cat} product`, "12.00")] });
    return json({ total: 3, itemSummaries: [summary("v1|1|0", "Electric Can Opener Automatic Hands Free", "30.00"), summary("v1|2|0", "Automatic Can Opener Electric", "25.00"), summary("v1|4|0", "Nike Can Opener", "15.00")] });
  }
  if (p === "/buy/browse/v1/item/") {
    const ids = (u.searchParams.get("item_ids") ?? "").split(",");
    return json({ items: ids.map((id) => ({ itemId: id, estimatedAvailabilities: [{ estimatedSoldQuantity: sold[id] ?? 0 }] })) });
  }
  if (p.endsWith("/get_default_category_tree_id")) return json({ categoryTreeId: "0" });
  if (p.endsWith("/get_category_suggestions")) return json({ categorySuggestions: [{ category: { categoryId: `C${(u.searchParams.get("q") ?? "").length}`, categoryName: "Cat" } }] });
  return json({ errors: [{ message: `route inconnue ${url}` }] }, 500);
}

beforeEach(() => {
  vi.stubEnv("EBAY_CLIENT_ID", "id");
  vi.stubEnv("EBAY_CLIENT_SECRET", "secret");
  vi.stubEnv("DATABASE_URL", "postgresql://x");
  vi.stubEnv("SESSION_SECRET", "x".repeat(32));
  vi.stubEnv("ENCRYPTION_KEY", "0".repeat(64));
  mem.cache.clear(); mem.trends = []; mem.seq = 0; browseCalls = 0;
  sold = { "v1|1|0": 120, "v1|2|0": 30, "v1|3|0": 0, "v1|4|0": 10 };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => router(url)));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("recherche marché", () => {
  it("Title Builder : mots classés par ventes, titre proposé sans marque protégée", async () => {
    const r = await analyzeTitles("Can Opener", "EBAY_US");
    expect(r.keyword).toBe("can opener");
    expect(r.keywords.slice(0, 4).map((k) => [k.word, k.sold])).toEqual([["can", 160], ["opener", 160], ["automatic", 150], ["electric", 150]]);
    expect(r.keywords.find((k) => k.word === "nike")?.vero).toBe(true);
    expect(r.suggestion.toLowerCase()).not.toContain("nike");
    expect(r.topTitles[0]).toMatchObject({ sold: 120 });
    expect(r).toMatchObject({ listingsAnalyzed: 3 });
    expect(r).not.toHaveProperty("unitsSold"); // pas de total de ventes agrégé affiché
  });

  it("pays des clients : les États-Unis toujours, puis ceux des abonnés", async () => {
    expect(await trendMarkets()).toEqual(["EBAY_US", "EBAY_DE"]);
  });
});
