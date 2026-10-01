import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown> & { userId: string; supplier: string; productId: string; createdAt: Date };
const mem = vi.hoisted(() => ({ rows: [] as Row[], seq: 0, runs: [] as unknown[] }));

const matches = (r: Row, where: Record<string, unknown>) => Object.entries(where).every(([k, v]) => r[k] === v);

vi.mock("@/lib/db", () => ({
  db: {
    savedProduct: {
      findUnique: vi.fn(async ({ where }: { where: { userId_supplier_productId: Record<string, string> } }) =>
        mem.rows.find((r) => matches(r, where.userId_supplier_productId)) ?? null),
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => mem.rows.filter((r) => matches(r, where)).length),
      findMany: vi.fn(async ({ where, take }: { where: Record<string, unknown>; take?: number }) =>
        mem.rows.filter((r) => matches(r, where)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, take)),
      upsert: vi.fn(async ({ where, create, update }: { where: { userId_supplier_productId: Record<string, string> }; create: Row; update: Record<string, unknown> }) => {
        const r = mem.rows.find((x) => matches(x, where.userId_supplier_productId));
        if (r) return Object.assign(r, update);
        const n = { ...create, id: `s${++mem.seq}`, createdAt: new Date(Date.now() + mem.seq) };
        mem.rows.push(n);
        return n;
      }),
      deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const before = mem.rows.length;
        mem.rows = mem.rows.filter((r) => !matches(r, where));
        return { count: before - mem.rows.length };
      }),
    },
  },
}));

vi.mock("@/lib/sniper-service", () => ({
  MAX_IDEAS_PER_RUN: 50,
  createRun: vi.fn(async (_user: unknown, input: unknown) => { mem.runs.push(input); return { id: "run1" }; }),
}));

import { cleanSaveInput, MAX_SAVED, removeSaved, SavedError, savedKeys, saveProduct, sendSavedToSniper } from "./saved-products";

const base = { supplier: "CJ", productId: "ABC-123456", title: "  Garlic   press ", image: "https://cf.cjdropshipping.com/a.jpg", keyword: "garlic press", marketId: "EBAY_US", price: 24.99, cost: 8.123, profit: 9.5, marginPct: 38 };

beforeEach(() => { mem.rows = []; mem.seq = 0; mem.runs = []; });

describe("cleanSaveInput", () => {
  it("garde les champs valides et nettoie le texte", () => {
    const r = cleanSaveInput(base)!;
    expect(r).toMatchObject({ supplier: "CJ", productId: "ABC-123456", title: "Garlic press", marketId: "EBAY_US", cost: 8.12, profit: 9.5 });
  });
  it("refuse un produit sans identifiant valide ou un fournisseur inconnu", () => {
    expect(cleanSaveInput({ ...base, productId: "x" })).toBeNull();
    expect(cleanSaveInput({ ...base, productId: "../etc/passwd" })).toBeNull();
    expect(cleanSaveInput({ ...base, supplier: "AMAZON" })).toBeNull();
    expect(cleanSaveInput(null)).toBeNull();
  });
  it("ignore une image non https, un site eBay inconnu et des nombres invalides", () => {
    const r = cleanSaveInput({ ...base, image: "javascript:alert(1)", marketId: "EBAY_XX", price: "12", profit: Number.NaN })!;
    expect(r.image).toBeNull();
    expect(r.marketId).toBeNull();
    expect(r.price).toBeNull();
    expect(r.profit).toBeNull();
  });
  it("CJ par défaut quand le fournisseur n'est pas donné (extension)", () => {
    expect(cleanSaveInput({ productId: "ABC-123456" })?.supplier).toBe("CJ");
  });
});

describe("saveProduct / removeSaved", () => {
  it("sauvegarde une seule fois le même produit et garde l'instantané", async () => {
    await saveProduct("u1", cleanSaveInput(base)!);
    await saveProduct("u1", cleanSaveInput(base)!);
    expect(mem.rows).toHaveLength(1);
    expect(await savedKeys("u1")).toEqual(["CJ:ABC-123456"]);
  });
  it("une sauvegarde sans chiffres (extension) n'efface pas les chiffres du Sniper", async () => {
    await saveProduct("u1", cleanSaveInput(base)!);
    await saveProduct("u1", cleanSaveInput({ productId: "ABC-123456", title: "New title" })!);
    expect(mem.rows[0]).toMatchObject({ profit: 9.5, price: 24.99, title: "New title" });
  });
  it("refuse au-delà de la limite, mais accepte la mise à jour d'un produit déjà gardé", async () => {
    for (let i = 0; i < MAX_SAVED; i++) mem.rows.push({ userId: "u1", supplier: "CJ", productId: `P-${100000 + i}`, createdAt: new Date() });
    await expect(saveProduct("u1", cleanSaveInput(base)!)).rejects.toBeInstanceOf(SavedError);
    await expect(saveProduct("u1", cleanSaveInput({ ...base, productId: "P-100000" })!)).resolves.toBeTruthy();
    await expect(saveProduct("u2", cleanSaveInput(base)!)).resolves.toBeTruthy(); // limite par utilisateur
  });
  it("retire un produit ou tout, sans toucher aux autres utilisateurs", async () => {
    await saveProduct("u1", cleanSaveInput(base)!);
    await saveProduct("u1", cleanSaveInput({ ...base, productId: "XYZ-999999" })!);
    await saveProduct("u2", cleanSaveInput(base)!);
    expect(await removeSaved("u1", { supplier: "CJ", productId: "ABC-123456" })).toBe(1);
    expect(await savedKeys("u1")).toEqual(["CJ:XYZ-999999"]);
    expect(await removeSaved("u1", "all")).toBe(1);
    expect(await savedKeys("u2")).toEqual(["CJ:ABC-123456"]);
  });
});

describe("sendSavedToSniper", () => {
  const user = { id: "u1", defaultMarketplace: "EBAY_GB" } as never;
  it("refuse une liste vide", async () => {
    await expect(sendSavedToSniper(user, undefined)).rejects.toMatchObject({ code: "SAVED_EMPTY" });
  });
  it("envoie les produits CJ au Sniper, sur le site demandé ou celui par défaut", async () => {
    await saveProduct("u1", cleanSaveInput(base)!);
    await saveProduct("u1", cleanSaveInput({ ...base, supplier: "ALIEXPRESS", productId: "100500" + "123" })!);
    expect(await sendSavedToSniper(user, "EBAY_DE")).toEqual({ runId: "run1", count: 1 });
    expect(mem.runs[0]).toMatchObject({ mode: "CATALOG", marketId: "EBAY_DE", products: [{ productId: "ABC-123456" }] });
    await sendSavedToSniper(user, "nope");
    expect(mem.runs[1]).toMatchObject({ marketId: "EBAY_GB" });
  });
});
