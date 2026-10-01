import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const mem = vi.hoisted(() => ({
  ext: [] as Row[],
  listings: [] as Row[],
  state: new Map<string, Row>(),
  active: new Map<string, unknown[] | Error>(),
  seq: 0,
  quote: { kind: "ok", stock: 40, unitPrice: 8, shipping: 3.45, deliveryDaysMax: 5, service: "CJPacket" } as Record<string, unknown>,
  oos: 0,
}));

function match(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, cond]) => {
    const v = row[k];
    if (cond && typeof cond === "object" && !(cond instanceof Date) && !Array.isArray(cond)) {
      const c = cond as Record<string, unknown>;
      if ("in" in c) return (c.in as unknown[]).includes(v);
      if ("notIn" in c) return !(c.notIn as unknown[]).includes(v);
      if ("not" in c) return c.not === null ? v !== null && v !== undefined : v !== c.not;
      if ("ebayAccountId" in c && "itemId" in c) return row.ebayAccountId === c.ebayAccountId && row.itemId === c.itemId;
    }
    return v === cond;
  });
}

vi.mock("@/lib/db", () => {
  const table = (get: () => Row[], set: (r: Row[]) => void) => ({
    findMany: vi.fn(async ({ where }: { where: Row }) => get().filter((r) => match(r, where)).map((r) => ({ ...r }))),
    findFirst: vi.fn(async ({ where }: { where: Row }) => get().find((r) => match(r, where)) ?? null),
    findUnique: vi.fn(async ({ where }: { where: Row }) => get().find((r) => match(r, where)) ?? null),
    create: vi.fn(async ({ data }: { data: Row }) => { const r = { id: `id${++mem.seq}`, ...data }; get().push(r); return r; }),
    update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => Object.assign(get().find((r) => r.id === where.id)!, data)),
    updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => { const rows = get().filter((r) => match(r, where)); rows.forEach((r) => Object.assign(r, data)); return { count: rows.length }; }),
    deleteMany: vi.fn(async ({ where }: { where: Row }) => { const before = get().length; set(get().filter((r) => !match(r, where))); return { count: before - get().length }; }),
    upsert: vi.fn(async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
      const key = (where.ebayAccountId_itemId ?? where) as Row;
      const r = get().find((x) => x.ebayAccountId === key.ebayAccountId && x.itemId === key.itemId);
      if (r) return Object.assign(r, update);
      const n = { id: `id${++mem.seq}`, listingId: null, ...create };
      get().push(n);
      return n;
    }),
  });
  return {
    db: {
      externalListing: table(() => mem.ext, (r) => { mem.ext = r; }),
      listing: table(() => mem.listings, (r) => { mem.listings = r; }),
      appState: {
        findUnique: vi.fn(async ({ where }: { where: { key: string } }) => mem.state.get(where.key) ?? null),
        upsert: vi.fn(async ({ where, create }: { where: { key: string }; create: Row }) => { mem.state.set(where.key, create); return create; }),
      },
    },
  };
});

vi.mock("@/lib/ebay-account", () => ({ userToken: vi.fn(async (a: { id: string }) => `TOKEN-${a.id}`) }));
vi.mock("@/lib/fx", () => ({ getUsdRates: vi.fn(async () => ({ EUR: 0.9 })), convertFromUsd: (v: number) => v }));
vi.mock("@/lib/ebay", async (orig) => {
  const real = await orig<typeof import("@/lib/ebay")>();
  return {
    ...real,
    getActiveListings: vi.fn(async (token: string) => {
      const r = mem.active.get(token) ?? [];
      if (r instanceof Error) throw r;
      return r;
    }),
    enableOutOfStockControl: vi.fn(async () => { mem.oos++; return true; }),
  };
});
vi.mock("@/lib/suppliers", async (orig) => {
  const real = await orig<typeof import("@/lib/suppliers")>();
  return {
    ...real,
    openSession: vi.fn(async (accounts: { supplier: string }[], supplier: string) => {
      if (!accounts.some((a) => a.supplier === supplier)) throw new real.SupplierError("SUPPLIER_UNSUPPORTED");
      return { supplier: "CJ", token: "CJT" };
    }),
    quote: vi.fn(async () => mem.quote),
    variantsOf: vi.fn(async (_s: unknown, productId: string) =>
      productId === "GONE" ? null : { productId, title: "Garlic press", image: null, variants: [{ id: "V1", label: "Silver", price: 8, stock: 40 }, { id: "V2", label: "Black", price: 9, stock: 0 }] }),
  };
});

import { linkExternal, marketOfItem, previewLink, syncExternalListings, syncIfDue, unlinkExternal } from "./external-listings";
import { parseActiveList } from "./ebay";
import { parseSupplierInput } from "./suppliers";

const item = (itemId: string, over: Row = {}) => ({
  itemId, title: `Item ${itemId}`, sku: null, price: 29.99, currency: "USD", quantity: 5, image: "https://i.ebayimg.com/a.jpg",
  url: `https://www.ebay.com/itm/${itemId}`, startedAt: "2026-09-01T10:00:00.000Z", hasVariations: false, fixedPrice: true, ...over,
});

const user = (over: Row = {}) =>
  ({
    id: "U1", plan: "PRO", minMarginPct: 30, defaultMarketplace: "EBAY_US",
    ebayAccounts: [{ id: "ACC", accessToken: "a", accessTokenExpires: new Date(), refreshToken: "r", refreshTokenExpires: new Date() }],
    supplierAccounts: [{ supplier: "CJ", accessToken: "x" }],
    ...over,
  }) as never;

beforeEach(() => {
  mem.ext = []; mem.listings = []; mem.state = new Map(); mem.active = new Map(); mem.seq = 0; mem.oos = 0;
  mem.quote = { kind: "ok", stock: 40, unitPrice: 8, shipping: 3.45, deliveryDaysMax: 5, service: "CJPacket" };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("lecture des annonces eBay (API Trading)", () => {
  const xml = `<?xml version="1.0"?><GetMyeBaySellingResponse><Ack>Success</Ack><ActiveList><ItemArray>
    <Item><ItemID>111</ItemID><ListingType>FixedPriceItem</ListingType><Title>Garlic Press &amp; Peeler</Title><SKU>MY-1</SKU>
      <SellingStatus><CurrentPrice currencyID="USD">24.99</CurrentPrice></SellingStatus><QuantityAvailable>7</QuantityAvailable>
      <ListingDetails><StartTime>2026-09-01T10:00:00.000Z</StartTime><ViewItemURL>https://www.ebay.com/itm/111</ViewItemURL></ListingDetails>
      <PictureDetails><GalleryURL>https://i.ebayimg.com/1.jpg</GalleryURL></PictureDetails></Item>
    <Item><ItemID>222</ItemID><ListingType>FixedPriceItem</ListingType><Title>Shirt</Title>
      <SellingStatus><CurrentPrice currencyID="EUR">15.00</CurrentPrice></SellingStatus><QuantityAvailable>12</QuantityAvailable>
      <Variations><Variation><SKU>VAR-RED</SKU></Variation></Variations>
      <ListingDetails><ViewItemURL>https://www.ebay.fr/itm/222</ViewItemURL></ListingDetails></Item>
    <Item><ItemID>333</ItemID><ListingType>Chinese</ListingType><Title>Auction</Title><SellingStatus><CurrentPrice currencyID="USD">1.00</CurrentPrice></SellingStatus></Item>
  </ItemArray><PaginationResult><TotalNumberOfPages>3</TotalNumberOfPages><TotalNumberOfEntries>450</TotalNumberOfEntries></PaginationResult></ActiveList></GetMyeBaySellingResponse>`;

  it("lit chaque annonce : prix, devise, quantité, SKU (hors variantes), photo, lien, enchère repérée", () => {
    const { items, totalPages } = parseActiveList(xml);
    expect(totalPages).toBe(3);
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({ itemId: "111", title: "Garlic Press & Peeler", sku: "MY-1", price: 24.99, currency: "USD", quantity: 7, image: "https://i.ebayimg.com/1.jpg", url: "https://www.ebay.com/itm/111", startedAt: "2026-09-01T10:00:00.000Z", hasVariations: false, fixedPrice: true });
    expect(items[1]).toMatchObject({ itemId: "222", sku: null, currency: "EUR", hasVariations: true, quantity: 12 });
    expect(items[2]).toMatchObject({ itemId: "333", fixedPrice: false });
    expect(parseActiveList("<GetMyeBaySellingResponse><Ack>Success</Ack></GetMyeBaySellingResponse>")).toEqual({ items: [], totalPages: 1 });
  });

  it("site eBay de l'annonce : d'après son lien, sinon sa devise", () => {
    expect(marketOfItem("https://www.ebay.fr/itm/1", "EUR", "EBAY_US")).toBe("EBAY_FR");
    expect(marketOfItem("https://ebay.co.uk/itm/1", "GBP", "EBAY_US")).toBe("EBAY_GB");
    expect(marketOfItem(null, "CAD", "EBAY_US")).toBe("EBAY_CA");
    expect(marketOfItem(null, "EUR", "EBAY_IT")).toBe("EBAY_IT");
    expect(marketOfItem(null, "XYZ", "EBAY_US")).toBe("EBAY_US");
  });

  it("lien ou numéro de produit fournisseur", () => {
    expect(parseSupplierInput("https://cjdropshipping.com/product/garlic-press-p-1A2B3C4D-5E6F.html")).toEqual({ supplier: "CJ", productId: "1A2B3C4D-5E6F" });
    expect(parseSupplierInput("2052596452905111554")).toEqual({ supplier: "CJ", productId: "2052596452905111554" });
    expect(parseSupplierInput("https://www.aliexpress.com/item/1005006123456789.html")).toEqual({ supplier: "ALIEXPRESS", productId: "1005006123456789" });
    expect(parseSupplierInput("1005006123456789", "ALIEXPRESS")).toEqual({ supplier: "ALIEXPRESS", productId: "1005006123456789" });
    expect(parseSupplierInput("https://www.amazon.com/dp/B000")).toBeNull();
    expect(parseSupplierInput("  ")).toBeNull();
  });
});

describe("synchronisation", () => {
  it("ajoute les annonces créées hors de Sellvela, ignore les nôtres et les enchères, retire celles qui ne sont plus en ligne", async () => {
    mem.listings = [{ id: "OWN", userId: "U1", legacy: false, ebayListingId: "OURS", status: "ACTIVE" }];
    mem.active.set("TOKEN-ACC", [item("A1", { sku: "MY-1" }), item("OURS"), item("AUC", { fixedPrice: false }), item("FR", { currency: "EUR", url: "https://www.ebay.fr/itm/FR" })]);
    const r = await syncExternalListings(user());
    expect(r).toEqual({ accounts: 1, found: 2, ended: 0, errors: 0 });
    expect(mem.ext.map((e) => e.itemId).sort()).toEqual(["A1", "FR"]);
    expect(mem.ext.find((e) => e.itemId === "FR")).toMatchObject({ marketplace: "EBAY_FR", currency: "EUR" });

    // L'annonce A1 est liée, puis retirée d'eBay : la gestion s'arrête.
    mem.listings.push({ id: "L-A1", userId: "U1", legacy: true, ebayListingId: "A1", status: "ACTIVE" });
    mem.ext.find((e) => e.itemId === "A1")!.listingId = "L-A1";
    mem.active.set("TOKEN-ACC", [item("FR", { currency: "EUR", url: "https://www.ebay.fr/itm/FR", price: 19.5 })]);
    expect(await syncExternalListings(user())).toMatchObject({ found: 1, ended: 1 });
    expect(mem.ext.map((e) => e.itemId)).toEqual(["FR"]);
    expect(mem.ext[0].price).toBe(19.5);
    expect(mem.listings.find((l) => l.id === "L-A1")!.status).toBe("ENDED");
  });

  it("lecture impossible : rien n'est retiré", async () => {
    mem.ext = [{ id: "E1", userId: "U1", ebayAccountId: "ACC", itemId: "A1", listingId: null }];
    mem.active.set("TOKEN-ACC", new Error("eBay down"));
    expect(await syncExternalListings(user())).toEqual({ accounts: 0, found: 0, ended: 0, errors: 1 });
    expect(mem.ext).toHaveLength(1);
  });

  it("une lecture à la main par minute au plus ; la date n'est enregistrée qu'après une lecture réussie", async () => {
    mem.active.set("TOKEN-ACC", [item("A1")]);
    expect(await syncIfDue(user(), 60_000)).toMatchObject({ found: 1 });
    expect(await syncIfDue(user(), 60_000)).toBeNull();
    expect(await syncIfDue(user(), 60_000, Date.now() + 61_000)).toMatchObject({ found: 1 });
    await expect(syncIfDue(user({ ebayAccounts: [] }), 60_000)).rejects.toMatchObject({ code: "EBAY_NOT_CONNECTED" });
  });
});

describe("liaison à un produit fournisseur", () => {
  beforeEach(async () => {
    mem.active.set("TOKEN-ACC", [item("A1", { sku: "MY-1", price: 30.75, quantity: 8 }), item("VAR", { hasVariations: true })]);
    await syncExternalListings(user());
  });
  const extId = (itemId: string) => mem.ext.find((e) => e.itemId === itemId)!.id as string;

  it("aperçu : variantes, coût livré, bénéfice et marge au prix de l'annonce", async () => {
    const p = await previewLink(user(), extId("A1"), { supplier: "CJ", productId: "P1" });
    expect(p.variants).toHaveLength(2);
    // 30,75 − (8 + 3,45) − frais eBay ≈ 14,72 → 47,9 %
    expect(p.selected).toMatchObject({ variantId: "V1", cost: 11.45, marginPct: 47.9, available: true, belowMinMargin: false });
    await expect(previewLink(user(), extId("A1"), { supplier: "CJ", productId: "GONE" })).rejects.toMatchObject({ code: "PRODUCT_NOT_FOUND" });
    await expect(previewLink(user(), extId("VAR"), { supplier: "CJ", productId: "P1" })).rejects.toMatchObject({ code: "HAS_VARIATIONS" });
    await expect(previewLink(user({ supplierAccounts: [] }), extId("A1"), { supplier: "CJ", productId: "P1" })).rejects.toMatchObject({ code: "SUPPLIER_NOT_CONNECTED" });
    await expect(previewLink(user({ id: "OTHER" }), extId("A1"), { supplier: "CJ", productId: "P1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lier crée une annonce gérée (API Trading) avec le SKU du vendeur ; refus si déjà gérée ; reprise après « ne plus gérer »", async () => {
    const l = await linkExternal(user(), extId("A1"), { supplier: "CJ", productId: "P1", variantId: "V1" });
    expect(l).toMatchObject({
      userId: "U1", legacy: true, ebayOfferId: null, ebayListingId: "A1", sku: "MY-1", status: "ACTIVE", price: 30.75, quantity: 8,
      supplier: "CJ", supplierProductId: "P1", supplierVariantId: "V1", supplierCost: 11.45, lastCheckedAt: null, ebayAccountId: "ACC",
    });
    expect(mem.oos).toBe(1); // option « rupture de stock » activée : une quantité 0 met en pause sans terminer l'annonce
    expect(mem.ext.find((e) => e.itemId === "A1")!.listingId).toBe(l.id);
    await expect(linkExternal(user(), extId("A1"), { supplier: "CJ", productId: "P1", variantId: "V1" })).rejects.toMatchObject({ code: "ALREADY_LINKED" });

    await unlinkExternal(user(), extId("A1"));
    expect(mem.listings.find((x) => x.id === l.id)!.status).toBe("ENDED");
    expect(mem.ext.find((e) => e.itemId === "A1")!.listingId).toBeNull();

    const again = await linkExternal(user(), extId("A1"), { supplier: "CJ", productId: "P2", variantId: "V2" });
    expect(again.id).toBe(l.id); // même annonce gérée, historique conservé
    expect(mem.listings.filter((x) => x.legacy)).toHaveLength(1);
    expect(again).toMatchObject({ status: "ACTIVE", supplierProductId: "P2", sku: "MY-1" });
  });

  it("SKU du vendeur déjà pris par une autre annonce : SKU EXT-numéro d'annonce", async () => {
    mem.listings.push({ id: "OTHER", userId: "U2", sku: "MY-1", legacy: false });
    const l = await linkExternal(user(), extId("A1"), { supplier: "CJ", productId: "P1", variantId: "V1" });
    expect(l.sku).toBe("EXT-A1");
  });

  it("produit en rupture : liaison possible, la surveillance mettra l'annonce en pause", async () => {
    mem.quote = { kind: "no_stock" };
    const p = await previewLink(user(), extId("A1"), { supplier: "CJ", productId: "P1" });
    expect(p.selected).toMatchObject({ available: false, cost: null });
    const l = await linkExternal(user(), extId("A1"), { supplier: "CJ", productId: "P1", variantId: "V1" });
    expect(l).toMatchObject({ supplierCost: 0, lastMarginPct: null, lastCheckedAt: null });
  });
});
