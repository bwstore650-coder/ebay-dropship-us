import { beforeEach, describe, expect, it, vi } from "vitest";
import { consensusWords, costBand, monthlySales, pickComparables, titleWords } from "./comparables";

/** Résultats réels de la recherche par image (photo CJ du support de dips), 1er octobre 2026. */
const IMAGE_RESULTS = [
  ["Power Tower Dip Station Pull Up Bar Stand Adjustable Height Heavy Duty Multi-Fun", 69.99],
  ["Power Tower Dip Station w/Bench Pull Up Bar Stand Adjustable For Home Strength", 42.99],
  ["Adjustable Dip Station Power Tower Pull‑Up Bar Home Fitness Training Equipment", 91.86],
  ["Power Tower Dip Station Pull Up Bar Stand Adjustable Height Home Gym", 121.97],
  ["Power Tower Dip Station Pull Up Bar Stand Adjustable Height Heavy Duty Multi-Fun", 65.95],
  ["Power Tower Dip Station Pull Up Bar Stand Adjustable Height Heavy Duty Multi-Fun", 69.16],
  ["Adjustable Height Power Tower for Pull Ups and Dips - Heavy Duty Gym Equipment", 74.84],
  ["Power Tower Dip Station Pull Up Bar Stand Adjustable Height Heavy Duty", 83.0],
  ["Adjustable Heavy Duty Power Tower Multi-Function Pull Up Dip Station", 88.0],
  ["Power Tower Dip Station & Pull Up Bar - Adjustable Height Home Gym Fitness", 58.99],
  ["Power Tower Dip Station Pull Up Bar Stand Adjustable Height Heavy Duty", 69.97],
  ["Power Tower Dip Station with Bench Pull Up Bar Stand Adjustable Height Black New", 45.59],
  ["Home balance frame indoor and outdoor grips protect high-strength structures", 69.99],
  ["Dip Station Functional Heavy Duty Dip Stands Fitness Workout Dip bar Black", 81.52],
  ["Phone case for iPhone", 9.99],
  ["Commercial power tower rack 1000 lbs", 899],
].map(([title, price], i) => ({ id: `I${i}`, title: title as string, price: price as number, categoryId: i === 2 ? "999" : "15273" }));

describe("annonces comparables (recherche par image)", () => {
  it("mots significatifs et mots communs", () => {
    expect(titleWords("Power Tower Dip Station w/Bench, Adjustable Height 550LBS")).toEqual(["power", "tower", "dip", "station", "bench", "height", "550lbs"]);
    expect(consensusWords(["red mug", "blue mug", "mug set", "lamp"])).toEqual(["mug"]);
    expect(consensusWords([])).toEqual([]);
  });

  it("garde le vrai produit : écarte les intrus de titre et de prix, en déduit une recherche précise", () => {
    const r = pickComparables(IMAGE_RESULTS);
    const ids = r.matches.map((m) => m.id);
    expect(ids).not.toContain("I12"); // « balance frame » : aucun mot commun
    expect(ids).not.toContain("I14"); // coque de téléphone à 9,99
    expect(ids).not.toContain("I15"); // rack à 899
    expect(ids).toContain("I0");
    expect(r.matches.length).toBeGreaterThanOrEqual(11);
    expect(r.keywords).toEqual(expect.arrayContaining(["dip", "power", "station", "tower"]));
    expect(r.categoryId).toBe("15273");
    expect(r.medianPrice).toBeGreaterThan(60);
    expect(r.medianPrice).toBeLessThan(80);
    expect(r.priceMin).toBeCloseTo(r.medianPrice! * 0.6, 1);
    expect(r.priceMax).toBeCloseTo(r.medianPrice! * 1.6, 1);
  });

  it("prix fournisseur de référence : les produits bien plus gros (ou les accessoires) sont écartés avant tout", () => {
    expect(costBand(38.59)).toEqual({ min: 19.3, max: 231.54 });
    expect(costBand(2)).toEqual({ min: 1, max: 42 });
    // Mini-serre en PVC à 39 $ : la photo ramène surtout des serres en polycarbonate à 340-520 $.
    const items = [
      ...["Walk-in Polycarbonate Greenhouse 8x6", "6x12FT Polycarbonate Greenhouse Walk-in", "8x8 FT Polycarbonate Greenhouse Door", "Heavy Duty Polycarbonate Greenhouse Patio"].map((t, i) => ({ id: `P${i}`, title: t, price: 340 + i * 60 })),
      ...["Mini Greenhouse PVC Cover Plant Grow Tent", "Portable Mini Greenhouse Clear PVC Plant Tent", "Mini Greenhouse Clear PVC Grow Tent Balcony", "Small Mini Greenhouse PVC Plant Cover"].map((t, i) => ({ id: `M${i}`, title: t, price: 45 + i * 8 })),
    ];
    const r = pickComparables(items, { supplierCost: 38.59 });
    expect(r.matches.map((m) => m.id)).toEqual(["M0", "M1", "M2", "M3"]);
    expect(r.keywords).toEqual(expect.arrayContaining(["greenhouse", "pvc"]));
  });

  it("aucun résultat exploitable", () => {
    expect(pickComparables([]).matches).toEqual([]);
    expect(pickComparables([{ id: "1", title: "x", price: 0 }]).medianPrice).toBeNull();
  });

  it("ventes estimées par mois : ventes ÷ mois en ligne (1 mois minimum)", () => {
    const now = Date.parse("2026-10-01T00:00:00Z");
    const ago = (days: number) => new Date(now - days * 86_400_000).toISOString();
    expect(monthlySales([
      { sold: 120, createdAt: ago(365) },  // 12 mois → ~9,9 / mois
      { sold: 30, createdAt: ago(61) },    // 2 mois → ~15 / mois
      { sold: 8, createdAt: ago(10) },     // moins d'un mois → 8
    ], now)).toBe(33);
    // Une annonce sans date compte au rythme moyen des autres.
    expect(monthlySales([{ sold: 10, createdAt: ago(30.44) }, { sold: 99 }], now)).toBe(20);
    expect(monthlySales([], now)).toBeNull();
    expect(monthlySales([{ sold: 5 }], now)).toBeNull();
  });
});

/* ---------- Chaîne complète : photo → annonces → ventes → concurrents (eBay simulé) ---------- */

const mem = vi.hoisted(() => ({ state: new Map<string, unknown>(), calls: [] as string[], imageFail: false }));
vi.mock("@/lib/db", () => ({
  db: {
    appState: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => (mem.state.has(where.key) ? { value: mem.state.get(where.key), expiresAt: new Date(Date.now() + 3600_000) } : null)),
      upsert: vi.fn(async ({ where, create }: { where: { key: string }; create: { value: unknown } }) => { mem.state.set(where.key, create.value); }),
    },
  },
}));

import { cachedImageDemand } from "./ebay-quota";

const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json" } });
const created = new Date(Date.now() - 4 * 30.44 * 86_400_000).toISOString(); // 4 mois

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://x");
  vi.stubEnv("SESSION_SECRET", "x".repeat(32));
  vi.stubEnv("ENCRYPTION_KEY", "0".repeat(64));
  vi.stubEnv("EBAY_CLIENT_ID", "id");
  vi.stubEnv("EBAY_CLIENT_SECRET", "secret");
  mem.state = new Map();
  mem.calls = [];
  mem.imageFail = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = new URL(url);
    mem.calls.push(u.pathname + (u.search.includes("category_ids") ? "?count" : ""));
    if (u.hostname === "cf.cjdropshipping.com") return new Response(new Uint8Array([1, 2, 3, 4]));
    if (u.pathname === "/identity/v1/oauth2/token") return json({ access_token: "APP", expires_in: 7200 });
    if (u.pathname.endsWith("/search_by_image")) {
      if (mem.imageFail) return json({ errors: [{ message: "boom" }] }, 500);
      return json({
        total: 8_447_660,
        itemSummaries: IMAGE_RESULTS.map((r) => ({ itemId: r.id, title: r.title, price: { value: String(r.price) }, leafCategoryIds: [r.categoryId], itemCreationDate: created })),
      });
    }
    if (u.pathname === "/buy/browse/v1/item_summary/search") {
      if (u.searchParams.get("category_ids")) return json({ total: 420 });
      return json({ total: 1656, itemSummaries: [{ itemId: "K1", title: "Power tower full", price: { value: "147" }, itemCreationDate: created }] });
    }
    if (u.pathname === "/buy/browse/v1/item/") {
      const ids = u.searchParams.get("item_ids")!.split(",");
      return json({ items: ids.map((id) => ({ itemId: id, estimatedAvailabilities: [{ estimatedSoldQuantity: 8 }] })) });
    }
    return json({ errors: [{ message: `inconnu ${url}` }] }, 500);
  }));
});

describe("marché d'après la photo du produit", () => {
  it("annonces comparables, ventes par mois et concurrents comptés par une recherche précise ; gardé 6 h", async () => {
    const r = await cachedImageDemand("https://cf.cjdropshipping.com/a.jpg", "power tower dip station pull", 10, "EBAY_US");
    expect(r.method).toBe("IMAGE");
    expect(r.analyzed).toHaveLength(10);
    expect(r.unitsSold).toBe(80);
    expect(r.monthlySales).toBe(20); // 10 annonces × 8 ventes en 4 mois
    expect(r.total).toBe(420); // et non les 8,4 millions de la recherche par image
    expect(r.search).toMatchObject({ categoryId: "15273" });
    expect(r.search!.q.split(" ")).toEqual(expect.arrayContaining(["power", "tower", "dip", "station"]));
    expect(Math.max(...r.prices)).toBeLessThan(200);
    const count = mem.calls.find((c) => c.endsWith("?count"));
    expect(count).toBeTruthy();

    mem.calls = [];
    await cachedImageDemand("https://cf.cjdropshipping.com/a.jpg", "power tower dip station pull", 10, "EBAY_US");
    expect(mem.calls).toEqual([]); // depuis le cache
  });

  it("prix fournisseur de référence : gardé avec la recherche (pour recharger les mêmes annonces) et dans la clé du cache", async () => {
    const r = await cachedImageDemand("https://cf.cjdropshipping.com/a.jpg", "power tower dip station pull", 10, "EBAY_US", 53.85);
    expect(r.search!.cost).toBe(53.85);
    expect(Math.max(...r.prices)).toBeLessThanOrEqual(323.1);
    mem.calls = [];
    await cachedImageDemand("https://cf.cjdropshipping.com/a.jpg", "power tower dip station pull", 10, "EBAY_US", 53.85);
    expect(mem.calls).toEqual([]);
  });

  it("mots-clés avec un prix fournisseur : les annonces à un prix impossible ne comptent pas", async () => {
    mem.imageFail = true;
    const r = await cachedImageDemand("https://cf.cjdropshipping.com/c.jpg", "mini greenhouse", 10, "EBAY_US", 10);
    expect(r.method).toBe("KEYWORD");
    expect(r.prices).toEqual([]); // l'annonce à 147 $ est hors de la gamme 5 – 60 $
    expect(r.unitsSold).toBe(0);
    expect(r.total).toBe(1656);
  });

  it("recherche par image en panne ou sans photo : recherche par mots-clés", async () => {
    mem.imageFail = true;
    const r = await cachedImageDemand("https://cf.cjdropshipping.com/b.jpg", "power tower dip station pull", 10, "EBAY_US");
    expect(r.method).toBe("KEYWORD");
    expect(r.total).toBe(1656);
    const r2 = await cachedImageDemand(null, "garlic press", 10, "EBAY_US");
    expect(r2.method).toBe("KEYWORD");
  });
});

describe("fiche eBay ouverte dans l'extension : ventes de l'annonce", () => {
  it("annonce simple, annonce à variantes (groupe), annonce introuvable", async () => {
    const { getItemSales } = await import("./ebay");
    const fetchMock = vi.fn(async (url: string) => {
      const u = new URL(url);
      if (u.pathname === "/identity/v1/oauth2/token") return json({ access_token: "APP", expires_in: 7200 });
      if (u.pathname.endsWith("/get_item_by_legacy_id")) {
        const id = u.searchParams.get("legacy_item_id");
        if (id === "222222222222") return json({ errors: [{ errorId: 11006, message: "item group" }] }, 400);
        if (id === "333333333333") return json({ errors: [{ errorId: 11001, message: "not found" }] }, 404);
        return json({ itemId: "v1|111111111111|0", title: "Dip station", price: { value: "41.85", currency: "USD" }, image: { imageUrl: "https://i.ebayimg.com/a.jpg" }, itemCreationDate: created, estimatedAvailabilities: [{ estimatedSoldQuantity: 76 }] });
      }
      if (u.pathname.endsWith("/get_items_by_item_group"))
        return json({ items: [1, 2, 3].map((n) => ({ itemId: `v1|222222222222|${n}`, title: "Shirt", price: { value: "15", currency: "USD" }, itemCreationDate: created, estimatedAvailabilities: [{ estimatedSoldQuantity: n * 10 }] })) });
      return json({}, 500);
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await getItemSales("111111111111")).toMatchObject({ title: "Dip station", price: 41.85, sold: 76, variations: 1, createdAt: created });
    expect(await getItemSales("222222222222")).toMatchObject({ title: "Shirt", sold: 60, variations: 3 });
    expect(await getItemSales("333333333333")).toBeNull();
  });
});
