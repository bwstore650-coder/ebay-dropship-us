/**
 * Test de bout en bout du Sniper (base de données, CJ et eBay simulés).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const mem = vi.hoisted(() => ({ runs: [] as Row[], cands: [] as Row[], listings: [] as Row[], users: [] as Row[], insights: [] as Row[], state: new Map<string, Row>(), seq: 0 }));

function match(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (k === "OR") return (cond as Row[]).some((c) => match(row, c));
    const v = row[k];
    if (cond && typeof cond === "object" && !(cond instanceof Date) && !Array.isArray(cond)) {
      const c = cond as Record<string, unknown>;
      if ("in" in c) return (c.in as unknown[]).includes(v);
      if ("notIn" in c) return !(c.notIn as unknown[]).includes(v);
      if ("not" in c) return v !== c.not;
      if ("contains" in c) return typeof v === "string" && v.toLowerCase().includes(String(c.contains).toLowerCase());
      const cmp = (a: unknown, b: unknown) => (a instanceof Date ? a.getTime() : (a as number)) - (b instanceof Date ? b.getTime() : (b as number));
      if (v === null || v === undefined) return false;
      if ("lt" in c && !(cmp(v, c.lt) < 0)) return false;
      if ("gt" in c && !(cmp(v, c.gt) > 0)) return false;
      if ("gte" in c && !(cmp(v, c.gte) >= 0)) return false;
      if ("lte" in c && !(cmp(v, c.lte) <= 0)) return false;
      return true;
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
    upsert: vi.fn(async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
      const key = Object.values(where)[0] as Row; // clé composée
      const r = table().find((x) => match(x, key));
      if (r) return { ...apply(r, update) };
      const n = { id: `id${++mem.seq}`, createdAt: new Date(), ...defaults(), ...create };
      table().push(n);
      return { ...n };
    }),
  };
}

vi.mock("@/lib/db", () => ({
  db: {
    snipeRun: model(() => mem.runs, () => ({ status: "RUNNING", scanned: 0, found: 0, listed: 0, lockedUntil: null, lastStepAt: null, error: null, cursor: null })),
    snipeCandidate: (() => {
      const m = model(() => mem.cands, () => ({ status: "PENDING", reason: null, supplier: null, productId: null, variantId: null, title: null }));
      const base = m.findMany;
      // Relation « run » (utilisée pour compter les vendeurs d'un produit).
      m.findMany = vi.fn(async (args: { where?: Row } = {}) => (await base(args)).map((c: Row) => ({ ...c, run: mem.runs.find((r) => r.id === c.runId) })));
      return m;
    })(),
    productInsight: model(() => mem.insights, () => ({ reason: null, variantId: null, image: null, details: null })),
    listing: model(() => mem.listings, () => ({})),
    user: model(() => mem.users, () => ({})),
    ebayMarketSetup: { findUnique: vi.fn(async () => null) }, // pas de réglages eBay → mise en vente auto arrêtée
    appState: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => mem.state.get(where.key) ?? null),
      upsert: vi.fn(async ({ where, create, update }: { where: { key: string }; create: Row; update: Row }) => {
        const r = { ...(mem.state.get(where.key) ?? create), ...update, key: where.key };
        mem.state.set(where.key, r);
        return r;
      }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  },
}));
vi.mock("@/lib/crypto", () => ({ decrypt: (s: string) => s, encrypt: (s: string) => s }));

import { advanceAll, advanceRun, continueRun, createRun, runState, SnipeError } from "./sniper-service";

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
let ebayQuotaOver = false;
let resetAt = "";

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
  if (path === "/developer/analytics/v1_beta/rate_limit/")
    return json({ rateLimits: [{ apiName: "Browse", resources: [{ name: "buy.browse", rates: [{ limit: 5000, remaining: ebayQuotaOver ? 0 : 5000, reset: resetAt }] }] }] });
  if (ebayQuotaOver && path.startsWith("/buy/browse/"))
    return json({ errors: [{ errorId: 2001, domain: "ACCESS", message: "Too many requests." }] }, 429);
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
  mem.runs = []; mem.cands = []; mem.listings = []; mem.insights = []; mem.users = [baseUser()]; mem.seq = 0; listCalls = 0;
  mem.state = new Map(); ebayQuotaOver = false; resetAt = new Date(Date.now() + 2 * 3600_000).toISOString();
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
    // Fiche complète : marché eBay, prix fournisseur, frais eBay, prix minimum.
    const d = by["P-GOOD"].details as { market: { listings: number; priceMin: number; priceMax: number }; fees: number; minPrice: number; supplierPrice: number; stock: number };
    expect(d.market).toMatchObject({ listings: expect.any(Number), priceMin: 25, priceMax: 31 });
    expect(d.market).not.toHaveProperty("soldTotal"); // pas de total de ventes agrégé
    expect(d.market).not.toHaveProperty("top"); // pas d'annonces eBay gardées en base
    expect(d.fees).toBeGreaterThan(0);
    expect(d.minPrice).toBeGreaterThan(12);
    expect(d.supplierPrice).toBeGreaterThan(0);
    expect(by["P-LOW"].details).toBeTruthy(); // un produit rejeté garde aussi son analyse
    expect(by["P-GOOD"].profit).toBeGreaterThan(10);
    expect(s.candidates[0].productId).toBe("P-GOOD"); // les rentables d'abord
    expect(listCalls).toBe(1);

    // Contrat eBay : au-delà de 24 h, les données eBay ne sont plus affichées.
    expect(by["P-GOOD"].expired).toBe(false);
    mem.cands.find((c) => c.productId === "P-GOOD")!.analyzedAt = new Date(Date.now() - 25 * 3600_000);
    const old = (await runState("U1", run.id))!.candidates.find((c) => c.productId === "P-GOOD")!;
    expect(old).toMatchObject({ expired: true, marketPrice: null, profit: null, marginPct: null, unitsSold: 0 });
    expect(old.details?.market).toBeUndefined();
    expect(old.details?.supplierPrice).toBeGreaterThan(0); // les données fournisseur restent
  });

  it("quota eBay atteint : la recherche se met en pause (sans rien rejeter à tort) puis reprend toute seule", async () => {
    ebayQuotaOver = true;
    const run = await createRun(mem.users[0] as never, { mode: "CATALOG", marketId: "EBAY_US", target: 1, seeds: ["kitchen"], autoList: false });
    await advanceRun(run.id, Date.now() + 80_000);
    let s = (await runState("U1", run.id))!;
    expect(s).toMatchObject({ status: "RUNNING", error: "EBAY_QUOTA", found: 0 });
    // Reprise annoncée à la remise à zéro d'eBay (+1 min).
    expect(new Date(s.pausedUntil!).getTime()).toBe(Date.parse(resetAt) + 60_000);
    // Le produit rentable n'a pas été classé « pas de ventes » : il attend.
    expect(mem.cands.find((c) => c.productId === "P-GOOD")!.status).toBe("PENDING");
    expect(mem.cands.some((c) => c.status === "ERROR")).toBe(false);

    // Pendant la pause : aucun appel à eBay.
    const calls = (fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    await advanceRun(run.id, Date.now() + 80_000);
    expect((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(calls);

    // Après la remise à zéro : la recherche continue et se termine normalement.
    ebayQuotaOver = false;
    mem.state.delete("ebay:browse:pause");
    await advanceRun(run.id, Date.now() + 80_000);
    s = (await runState("U1", run.id))!;
    expect(s).toMatchObject({ status: "DONE", error: null, found: 1, pausedUntil: null });
  });

  it("liste d'idées de l'extension : analyse seulement ces produits, mot-clé déduit du titre CJ, puis s'arrête", async () => {
    const run = await createRun(mem.users[0] as never, {
      mode: "CATALOG", marketId: "EBAY_US", target: 99, seeds: [], autoList: false,
      products: [{ productId: "P-GOOD", title: "Can opener" }, { productId: "P-OUT", title: null }],
    });
    expect(mem.runs.find((r) => r.id === run.id)).toMatchObject({ target: 2, cursor: { exhausted: true } });
    await advanceRun(run.id, Date.now() + 80_000);
    const s = (await runState("U1", run.id))!;
    expect(s).toMatchObject({ status: "DONE", scanned: 2, found: 1 });
    expect(listCalls).toBe(0); // pas de parcours du catalogue
    const by = Object.fromEntries(s.candidates.map((c) => [c.productId, c]));
    expect(by["P-GOOD"]).toMatchObject({ status: "PROFITABLE", keyword: "electric can opener automatic" });
    expect(by["P-OUT"]).toMatchObject({ status: "REJECTED", reason: "NO_SUPPLIER" });
  });

  it("continuer la recherche : nouveau lot de produits, erreurs réessayées, refus si déjà en cours", async () => {
    const run = await createRun(mem.users[0] as never, { mode: "CATALOG", marketId: "EBAY_US", target: 1, seeds: ["kitchen"], autoList: false });
    expect(await continueRun("U1", run.id)).toBe("NOT_FOUND"); // encore en cours
    await advanceRun(run.id, Date.now() + 80_000);
    const r = mem.runs.find((x) => x.id === run.id)!;
    r.status = "DONE";
    mem.cands.find((c) => c.runId === run.id && c.productId === "P-LOW")!.status = "ERROR";
    expect(await continueRun("U2", run.id)).toBe("NOT_FOUND"); // pas sa recherche
    expect(await continueRun("U1", run.id)).toBe("OK");
    expect(r).toMatchObject({ status: "RUNNING", target: 2, scanned: 3, scanLimit: 3 + 25 });
    expect(mem.cands.find((c) => c.runId === run.id && c.productId === "P-LOW")!.status).toBe("PENDING");
    r.status = "DONE";
    r.cursor = { round: 1, seed: 0, exhausted: true };
    expect(await continueRun("U1", run.id)).toBe("EXHAUSTED");
  });

  it("base commune : un 2e vendeur reçoit tout de suite les produits déjà analysés, dans la limite de 5 vendeurs", async () => {
    const r1 = await createRun(mem.users[0] as never, { mode: "CATALOG", marketId: "EBAY_US", target: 1, seeds: ["kitchen"], autoList: false });
    await advanceRun(r1.id, Date.now() + 80_000);
    const saved = mem.insights.find((i) => i.productId === "P-GOOD")!;
    expect(saved).toMatchObject({ marketplace: "EBAY_US", reason: null, unitsSold: 12 });
    expect(mem.insights.find((i) => i.productId === "P-OUT")).toMatchObject({ reason: "NO_SUPPLIER" });
    expect(mem.insights.find((i) => i.productId === "P-LOW")).toMatchObject({ reason: null }); // marge faible : dépend du vendeur

    // 2e vendeur : résultat immédiat, sans nouvelle analyse chez CJ.
    mem.users.push(baseUser({ id: "U2", email: "u2@x.io" }));
    const calls = (fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    const r2 = await createRun(mem.users[1] as never, { mode: "CATALOG", marketId: "EBAY_US", target: 1, seeds: [], autoList: false });
    const s2 = (await runState("U2", r2.id))!;
    expect(s2).toMatchObject({ status: "DONE", found: 1 });
    expect(s2.candidates[0]).toMatchObject({ productId: "P-GOOD", status: "PROFITABLE", profit: expect.any(Number) });
    expect((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(calls);

    // Déjà proposé à 5 vendeurs (U1, U2 + 3 autres) : plus proposé au suivant.
    for (const u of ["U3", "U4", "U5"]) {
      mem.runs.push({ id: `R-${u}`, userId: u });
      mem.cands.push({ id: `C-${u}`, runId: `R-${u}`, productId: "P-GOOD", status: "PROFITABLE", createdAt: new Date() });
    }
    mem.users.push(baseUser({ id: "U6", email: "u6@x.io" }));
    const r6 = await createRun(mem.users[2] as never, { mode: "CATALOG", marketId: "EBAY_US", target: 1, seeds: [], autoList: false });
    expect((await runState("U6", r6.id))!.found).toBe(0);
  });

  it("high ticket : moins de 100 de profit → rejeté, et la base ne propose que les produits à 100+ de profit", async () => {
    const run = await createRun(mem.users[0] as never, { mode: "CATALOG", marketId: "EBAY_US", target: 1, seeds: ["kitchen"], autoList: false, highTicket: true });
    expect(mem.runs.find((r) => r.id === run.id)).toMatchObject({ minProfit: 100 });
    await advanceRun(run.id, Date.now() + 80_000);
    const s = (await runState("U1", run.id))!;
    expect(s.minProfit).toBe(100);
    expect(s.candidates.find((c) => c.productId === "P-GOOD")).toMatchObject({ status: "REJECTED", reason: "LOW_PROFIT" });
    // Dans la base, le produit reste disponible pour les recherches normales, pas pour le high ticket.
    mem.users.push(baseUser({ id: "U2", email: "u2@x.io" }));
    const ht = await createRun(mem.users[1] as never, { mode: "CATALOG", marketId: "EBAY_US", target: 1, seeds: ["kitchen"], autoList: false, highTicket: true });
    expect(mem.cands.filter((c) => c.runId === ht.id && c.status === "PROFITABLE")).toHaveLength(0);
    const normal = await createRun(mem.users[1] as never, { mode: "CATALOG", marketId: "EBAY_US", target: 1, seeds: [], autoList: false }).catch(() => null);
    expect(normal).toBeNull(); // une recherche est déjà en cours pour ce vendeur
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
