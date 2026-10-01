import { beforeEach, describe, expect, it, vi } from "vitest";

const mem = vi.hoisted(() => ({
  tokens: [] as { id: string; userId: string; tokenHash: string; label: string | null; createdAt: Date; lastUsedAt: Date | null; user?: unknown }[],
  insight: null as Record<string, unknown> | null,
  state: new Map<string, { value: unknown; expiresAt: Date | null }>(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    extensionToken: {
      create: vi.fn(async ({ data }: { data: { userId: string; tokenHash: string; label: string | null } }) => {
        const r = { id: `t${mem.tokens.length + 1}`, createdAt: new Date(Date.now() + mem.tokens.length), lastUsedAt: null, ...data };
        mem.tokens.push(r);
        return r;
      }),
      findMany: vi.fn(async ({ where }: { where: { userId: string } }) =>
        mem.tokens.filter((t) => t.userId === where.userId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      ),
      deleteMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
        mem.tokens = mem.tokens.filter((t) => !where.id.in.includes(t.id));
        return { count: 0 };
      }),
      findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) => {
        const t = mem.tokens.find((x) => x.tokenHash === where.tokenHash);
        return t ? { ...t, user: { id: t.userId, email: "u@x.io" } } : null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { lastUsedAt: Date } }) => Object.assign(mem.tokens.find((t) => t.id === where.id)!, data)),
    },
    productInsight: { findUnique: vi.fn(async () => mem.insight), upsert: vi.fn() },
    appState: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => (mem.state.has(where.key) ? { key: where.key, ...mem.state.get(where.key)! } : null)),
      upsert: vi.fn(async ({ where, create, update }: { where: { key: string }; create: { value: unknown; expiresAt: Date }; update: { value: unknown } }) => {
        const prev = mem.state.get(where.key);
        mem.state.set(where.key, prev ? { ...prev, ...update } : { value: create.value, expiresAt: create.expiresAt });
      }),
    },
  },
}));
vi.mock("@/lib/crypto", () => ({ decrypt: (s: string) => s }));

import {
  analyzeForExtension, balanceIsLow, brandCheck, cleanProductId, createExtensionToken, extensionUser, feeCalculator, hashToken, MAX_TOKENS_PER_USER, TOKEN_PREFIX,
} from "./extension";
import { computeMargin, priceForTargetMargin } from "./margin";
import { MARKETPLACES } from "./marketplaces";

const req = (auth?: string) => new Request("https://sellvela.vercel.app/api/ext/summary", { headers: auth ? { authorization: auth } : {} });
const user = (over: Record<string, unknown> = {}) =>
  ({ id: "U1", plan: "PRO", minMarginPct: 30, defaultMarketplace: "EBAY_US", supplierAccounts: [{ supplier: "CJ", accessToken: "CJT" }], ebayAccounts: [], ...over }) as never;

beforeEach(() => {
  mem.tokens = []; mem.insight = null; mem.state = new Map();
  vi.stubEnv("APP_URL", "https://sellvela.vercel.app");
  vi.stubEnv("DATABASE_URL", "postgresql://x");
  vi.stubEnv("SESSION_SECRET", "x".repeat(32));
  vi.stubEnv("ENCRYPTION_KEY", "0".repeat(64));
});

describe("connexion de l'extension", () => {
  it("jeton aléatoire, seule l'empreinte est gardée ; reconnu avec « Bearer », refusé sinon", async () => {
    const token = await createExtensionToken("U1", "Chrome · macOS");
    expect(token.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(token.length).toBeGreaterThan(40);
    expect(mem.tokens[0]).toMatchObject({ userId: "U1", tokenHash: hashToken(token), label: "Chrome · macOS" });
    expect(JSON.stringify(mem.tokens)).not.toContain(token);
    expect(await extensionUser(req(`Bearer ${token}`))).toMatchObject({ id: "U1" });
    expect(mem.tokens[0].lastUsedAt).toBeInstanceOf(Date);
    expect(await extensionUser(req(`Bearer ${token}x`))).toBeNull();
    expect(await extensionUser(req(token))).toBeNull();
    expect(await extensionUser(req())).toBeNull();
  });
  it(`au plus ${MAX_TOKENS_PER_USER} navigateurs par compte : les plus anciens sont retirés`, async () => {
    for (let i = 0; i < MAX_TOKENS_PER_USER + 2; i++) await createExtensionToken("U1");
    expect(mem.tokens).toHaveLength(MAX_TOKENS_PER_USER);
  });
});

describe("outils", () => {
  it("identifiant produit CJ : seulement lettres, chiffres et tirets", () => {
    expect(cleanProductId("04A22450-67F0-4617-A132-E7AE7A8963B0")).toBe("04A22450-67F0-4617-A132-E7AE7A8963B0");
    expect(cleanProductId(" 1625321476425166848 ")).toBe("1625321476425166848");
    expect(cleanProductId("https://evil.example/x")).toBeNull();
    expect(cleanProductId("abc")).toBeNull();
    expect(cleanProductId(42)).toBeNull();
  });
  it("solde CJ bas : sous 50 $ ou sous le coût des commandes en attente", () => {
    expect(balanceIsLow(49, 0)).toBe(true);
    expect(balanceIsLow(80, 0)).toBe(false);
    expect(balanceIsLow(80, 120)).toBe(true);
  });
  it("calculateur : mêmes frais et même prix minimum que le reste de Sellvela", () => {
    const r = feeCalculator({ price: 39.99, cost: 12, shipping: 4, marketId: "EBAY_US", minMarginPct: 30 });
    const ref = computeMargin({ saleTotal: 39.99, supplierCost: 12, supplierShipping: 4, market: MARKETPLACES.EBAY_US });
    expect(r).toMatchObject({ ...ref, currency: "USD", marketId: "EBAY_US" });
    expect(r.minPrice).toBe(priceForTargetMargin(16, 30, { market: MARKETPLACES.EBAY_US }));
  });
  it("vérificateur de marque", () => {
    expect(brandCheck("Wireless earbuds for AirPods case")).toEqual({ brand: "airpods", risky: true });
    expect(brandCheck("S25 Ultra 5G smartphone dual SIM")).toEqual({ brand: "samsung", risky: true });
    expect(brandCheck("Silicone kitchen spatula set")).toEqual({ brand: null, risky: false });
  });
});

describe("analyse d'un produit depuis l'extension", () => {
  const pooled = (over: Record<string, unknown> = {}) => ({
    productId: "P1", keyword: "electric can opener", reason: null, title: "Electric Can Opener", image: "https://img/x.jpg", variantId: "V1",
    marketPrice: 29.99, cost: 12, profit: 13.5, marginPct: 45, unitsSold: 12, deliveryDaysMax: 5,
    details: { fees: 4.49, stock: 50 }, analyzedAt: new Date(), ...over,
  });

  it("produit déjà analysé (moins de 24 h) : résultat immédiat, sans appel CJ ni eBay", async () => {
    mem.insight = pooled();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const r = await analyzeForExtension(user(), "P1");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(r).toMatchObject({
      productId: "P1", status: "PROFITABLE", reason: null, profit: 13.5, marginPct: 45, fees: 4.49, stock: 50, vero: null, currency: "USD",
      createUrl: "https://sellvela.vercel.app/products/cj/P1?m=EBAY_US",
    });
    expect(r.minPrice).toBeGreaterThan(12);
    vi.unstubAllGlobals();
  });

  it("marge du vendeur : rentable à 30 % mais pas pour un vendeur à 50 %", async () => {
    mem.insight = pooled();
    expect(await analyzeForExtension(user({ minMarginPct: 50 }), "P1")).toMatchObject({ status: "REJECTED", reason: "LOW_MARGIN" });
  });

  it("marque protégée signalée ; forfait et compte CJ exigés", async () => {
    mem.insight = pooled({ title: "Case for Apple iPhone 15" });
    expect((await analyzeForExtension(user(), "P1")).vero).toBe("apple");
    await expect(analyzeForExtension(user({ plan: "NONE" }), "P1")).rejects.toMatchObject({ code: "PLAN_REQUIRED" });
    await expect(analyzeForExtension(user({ supplierAccounts: [] }), "P1")).rejects.toMatchObject({ code: "CJ_REQUIRED" });
  });

  it("analyses en direct limitées par heure (les analyses en base ne comptent pas)", async () => {
    mem.insight = null;
    const hour = Math.floor(Date.now() / 3600_000);
    mem.state.set(`extan:U1:${hour}`, { value: { n: 60 }, expiresAt: new Date((hour + 1) * 3600_000) });
    await expect(analyzeForExtension(user(), "P1")).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});
