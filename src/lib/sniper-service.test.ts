/**
 * Test de bout en bout du Sniper (base de données, CJ et eBay simulés).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const mem = vi.hoisted(() => ({ runs: [] as Row[], cands: [] as Row[], listings: [] as Row[], users: [] as Row[], seq: 0 }));

function match(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (k === "OR") return (cond as Row[]).some((c) => match(row, c));
    const v = row[k];
    if (cond && typeof cond === "object" && !(cond instanceof Date) && !Array.isArray(cond)) {
      const c = cond as Record<string, unknown>;
      if ("in" in c) return (c.in as unknown[]).includes(v);
      if ("not" in c) return v !== c.not;
      if ("lt" in c) return v instanceof Date && v < (c.lt as Date);
      if ("gte" in c) return v instanceof Date && v >= (c.gte as Date);
    }
    return v === cond;
  });
}
function apply(row: Row, data: Row) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && "increment" in (v as Row)) row[k] = (row[k] as number) + ((v as { increment: number }).increment);
    else row[k] = v;
  }
  return row;
}
function model(table: () => Row[], defaults: () => Row) {
  return {
    create: vi.fn(async ({ data }: { data: Row }) => {
      const r = { id: `id${++mem.seq}`, createdAt: new Date(Date.now() + mem.seq), ...defaults(), ...data };
      table().push(r);
      return { ...r };
    }),
    createMany: vi.fn(async ({ data }: { data: Row[] }) => {
      for (const d of data) table().push({ id: `id${++mem.seq}`, createdAt: new Date(Date.now() + mem.seq), ...defaults(), ...d });
      return { count: data.length };
    }),
    findFirst: vi.fn(async ({ where }: { where?: Row } = {}) => {
      const rows = table().filter((r) => match(r, where)).sort((a, b) => (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime());
      return rows[0] ? { ...rows[0] } : null;
    }),
    findUnique: vi.fn(async ({ where }: { where: Row }) => {
      const r = table().find((x) => match(x, where));
      return r ? { ...r } : null;
    }),
    findMany: vi.fn(async ({ where }: { where?: Row } = {}) => table().filter((r) => match(r, where)).map((r) => ({ ...r }))),
    count: vi.fn(async ({ where }: { where?: Row } = {}) => table().filter((r) => match(r, where)).length),
    update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => ({ ...apply(table().find((r) => match(r, where))!, data) })),
    updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const rows = table().filter((r) => match(r, where));
      rows.forEach((r) => apply(r, data));
      return { count: rows.length };
    }),
  };
}

vi.mock("@/lib/db", () => ({
  db: {
    snipeRun: model(() => mem.runs, () => ({ status: "RUNNING", scanned: 0, found: 0, listed: 0, lockedUntil: null, lastStepAt: null, error: null, cursor: null })),
    snipeCandidate: model(() => mem.cands, () => ({ status: "PENDING", reason: null, supplier: null, productId: null, variantId: null, title: null })),
    listing: model(() => mem.listings, () => ({})),
    user: model(() => mem.users, () => ({})),
    ebayMarketSetup: { findUnique: vi.fn(async () => null) }, // pas de réglages eBay → mise en vente auto arrêtée
  },
}));
vi.mock("@/lib/crypto", () => ({ decrypt: (s: string) => s, encrypt: (s: string) => s }));

import { advanceAll, advanceRun, createRun, runState, SnipeError } from "./sniper-service";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const cjOk = (data: unknown) => json({ code: 200, result: true, message: "ok", data });

/** Catalogue CJ : P-OUT (pas de stock local), P-LOW (trop cher), P-NIKE (marque protégée), P-GOOD (rentable). */
const PRODUCTS: Record<string, { name: string; price: number; stock: number }> = {
  "P-OUT": { name: "Silicone Stretch Lids Reusable", price: 3, stock: 0 },
  "P-LOW": { name: "Stainless Steel Garlic Press", price: 20, stock: 40 },
  "P-NIKE": { name: "Nike Style Running Socks", price: 2, stock: 40 },
  "P-GOOD": { name: "2024 New Electric Can Opener Automatic", price: 8, stock: 50 },
};
let listCalls = 0;

function router(url: string): Response {
  const u = new URL(url);
  const path = u.pathname;
  if (u.hostname === "developers.cjdropshipping.com") {
    if (path.endsWith("/product/listV2")) {
      listCalls++;
      const kw = u.searchParams.get("keyWord");
      if (kw === "electric can opener") return cjOk({ content: [{ productList: [{ id: "P-GOOD", nameEn: PRODUCTS["P-GOOD"].name }] }] });
      if (u.searchParams.get("page") !== "1") return cjOk({ content: [{ productList: [] }] });
      return cjOk({ content: [{ productList: Object.entries(PRODUCTS).map(([id, p]) => ({ id, nameEn: p.name })) }] });
    }
    if (path.endsWith("/product/query")) {
      const pid = u.searchParams.get("pid")!;
      const p = PRODUCTS[pid];
      return cjOk({
        pid, productNameEn: p.name, sellPrice: p.price, productImage: `https://cf.cj.com/${pid}.jpg`, description: "<p>Material: ABS, strong and durable for daily use.</p>",
        variants: [{ vid: `V-${pid}`, variantSku: "S", variantSellPrice: p.price, inventories: [{ countryCode: "US", totalInventory: p.stock }] }],
      });
    }
    if (path.endsWith("/logistic/freightCalculate")) return cjOk([{ logisticName: "CJPacket", logisticPrice: 4, logisticAging: "2-5" }]);
  }
  if (path === "/identity/v1/oauth2/token") return json({ access_token: "APP", expires_in: 7200, token_type: "Bearer" });
  if (path === "/buy/browse/v1/item_summary/search")
    return json({
      total: 3,
      itemSummaries: [
        { itemId: "1", title: "Automatic Electric Can Opener", price: { value: "29.99", currency: "USD" }, leafCategoryIds: ["20667"] },
        { itemId: "2", title: "Electric Can Opener Hands Free", price: { value: "31.00", currency: "USD" }, leafCategoryIds: ["20667"] },
        { itemId: "3", title: "Can opener", price: { value: "25.00", currency: "USD" }, leafCategoryIds: ["20667"] },
      ],
    });
  if (path.startsWith("/buy/browse/v1/item/")) return json({ estimatedAvailabilities: [{ estimatedSoldQuantity: 4 }] });
  if (path.endsWith("/get_default_category_tree_id")) return json({ categoryTreeId: "0" });
  if (path.endsWith("/get_item_aspects_for_category")) return json({ aspects: [] });
  if (path.endsWith("/get_category_subtree")) return json({ categorySubtreeNode: { category: { categoryName: "Can Openers" } } });
  return json({ errors: [{ message: `route inconnue ${url}` }] }, 500);
}

const baseUser = (over: Row = {}): Row => ({
  id: "U1", email: "u@x.io", plan: "PRO", minMarginPct: 30, ebayAccountOpenedAt: null, createdAt: new Date(0),
  euRpCompany: null, euRpAddress: null, euRpCity: null, euRpPostalCode: null, euRpCountry: null, euRpEmail: null,
  ebayAccounts: [{ id: "A1", accessToken: "USER", accessTokenExpires: new Date(Date.now() + 3600_000), refreshToken: "R", refreshTokenExpires: new Date(Date.now() + 86400_000) }],
  supplierAccounts: [{ supplier: "CJ", accessToken: "CJT" }],
  ...over,
});

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://x");
  vi.stubEnv("SESSION_SECRET", "x".repeat(32));
  vi.stubEnv("ENCRYPTION_KEY", "0".repeat(64));
  vi.stubEnv("EBAY_CLIENT_ID", "id");
  vi.stubEnv("EBAY_CLIENT_SECRET", "secret");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  mem.runs = []; mem.cands = []; mem.listings = []; mem.users = [baseUser()]; mem.seq = 0; listCalls = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => router(url)));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Sniper", { timeout: 90_000 }, () => {
  it("catalogue : écarte rupture, marge trop faible et marque protégée, garde le rentable, puis s'arrête", async () => {
    const run = await createRun(mem.users[0] as never, { mode: "CATALOG", marketId: "EBAY_US", target: 1, seeds: ["kitchen"], autoList: false });
    expect(await advanceRun(run.id, Date.now() + 80_000)).toBe(true);
    const s = (await runState("U1", run.id))!;
    expect(s).toMatchObject({ status: "DONE", found: 1, scanned: 4, listed: 0 });
    const by = Object.fromEntries(s.candidates.map((c) => [c.productId, c]));
    expect(by["P-OUT"]).toMatchObject({ status: "REJECTED", reason: "NO_SUPPLIER" });
    expect(by["P-LOW"]).toMatchObject({ status: "REJECTED", reason: "LOW_MARGIN" });
    expect(by["P-NIKE"]).toMatchObject({ status: "REJECTED", reason: "VERO" });
    expect(by["P-GOOD"]).toMatchObject({ status: "PROFITABLE", keyword: "electric can opener automatic", variantId: "V-P-GOOD", marketPrice: 29.99, cost: 12, unitsSold: 12, deliveryDaysMax: 5 });
    expect(by["P-GOOD"].profit).toBeGreaterThan(10);
    expect(s.candidates[0].productId).toBe("P-GOOD"); // les rentables d'abord
    expect(listCalls).toBe(1);
  });

  it("un produit déjà en vente n'est pas analysé à nouveau", async () => {
    mem.listings = [{ id: "L0", userId: "U1", supplier: "CJ", supplierProductId: "P-GOOD", status: "ACTIVE" }];
    const run = await createRun(mem.users[0] as never, { mode: "CATALOG", marketId: "EBAY_US", target: 1, seeds: ["kitchen"], autoList: false });
    await advanceRun(run.id, Date.now() + 80_000);
    const s = (await runState("U1", run.id))!;
    expect(s.candidates.map((c) => c.productId)).not.toContain("P-GOOD");
    expect(s.status).toBe("DONE"); // catalogue épuisé
    expect(s.found).toBe(0);
  });

  it("liste de mots-clés + mise en vente auto : arrêtée proprement si les réglages eBay manquent", async () => {
    const run = await createRun(mem.users[0] as never, { mode: "KEYWORDS", marketId: "EBAY_US", target: 5, seeds: ["electric can opener"], autoList: true });
    await advanceRun(run.id, Date.now() + 80_000);
    const s = (await runState("U1", run.id))!;
    expect(s).toMatchObject({ status: "DONE", found: 1, listed: 0, autoList: false, error: "EBAY_SETUP_REQUIRED" });
    expect(s.candidates[0]).toMatchObject({ status: "PROFITABLE", supplier: "CJ", productId: "P-GOOD", reason: "AUTO_LIST:EBAY_SETUP_REQUIRED" });
  });

  it("verrou : une recherche en cours de traitement n'est pas traitée deux fois ; reprise par la tâche planifiée", async () => {
    const run = await createRun(mem.users[0] as never, { mode: "KEYWORDS", marketId: "EBAY_US", target: 1, seeds: ["electric can opener"], autoList: false });
    mem.runs[0].lockedUntil = new Date(Date.now() + 60_000);
    expect(await advanceRun(run.id, Date.now() + 10_000)).toBe(false);
    mem.runs[0].lockedUntil = null;
    expect(await advanceAll(Date.now() + 80_000)).toBe(1);
    expect(mem.runs[0].status).toBe("DONE");
    expect(await advanceAll(Date.now() + 80_000)).toBe(0); // plus rien à reprendre
  });

  it("refus : sans formule, sans CJ, ou recherche déjà en cours", async () => {
    await expect(createRun(baseUser({ plan: "NONE" }) as never, { mode: "CATALOG", marketId: "EBAY_US", target: 5, seeds: [], autoList: false })).rejects.toMatchObject({ code: "PLAN_REQUIRED" });
    await expect(createRun(baseUser({ supplierAccounts: [] }) as never, { mode: "CATALOG", marketId: "EBAY_US", target: 5, seeds: [], autoList: false })).rejects.toBeInstanceOf(SnipeError);
    await createRun(mem.users[0] as never, { mode: "CATALOG", marketId: "EBAY_US", target: 5, seeds: [], autoList: false });
    await expect(createRun(mem.users[0] as never, { mode: "CATALOG", marketId: "EBAY_US", target: 5, seeds: [], autoList: false })).rejects.toMatchObject({ code: "SNIPE_RUNNING" });
    await expect(createRun(baseUser({ ebayAccounts: [] }) as never, { mode: "KEYWORDS", marketId: "EBAY_US", target: 5, seeds: ["x y"], autoList: true })).rejects.toMatchObject({ code: "EBAY_NOT_CONNECTED" });
  });
});
