import { db } from "@/lib/db";
import { isMarketplaceId, marketplace, type MarketplaceId } from "@/lib/marketplaces";
import { createRun, MAX_IDEAS_PER_RUN, type UserWithAccounts } from "@/lib/sniper-service";

/** Taille maximum de la liste de produits sauvegardés (partagée avec la liste d'idées de l'extension). */
export const MAX_SAVED = 200;

export type SavedSupplier = "CJ" | "ALIEXPRESS";

export interface SaveInput {
  supplier: SavedSupplier;
  productId: string;
  title: string | null;
  image: string | null;
  keyword: string | null;
  marketId: MarketplaceId | null;
  price: number | null;
  cost: number | null;
  profit: number | null;
  marginPct: number | null;
}

export class SavedError extends Error {
  constructor(public code: "INVALID_INPUT" | "SAVED_FULL" | "SAVED_EMPTY") {
    super(code);
  }
}

/** Identifiant produit fournisseur accepté (CJ / AliExpress). */
export function cleanSavedId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return /^[A-Za-z0-9-]{6,64}$/.test(v) ? v : null;
}

function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e7 ? Math.round(v * 100) / 100 : null;
}

/** Valide le corps d'une sauvegarde ; null si le produit n'est pas identifiable. */
export function cleanSaveInput(b: unknown): SaveInput | null {
  if (!b || typeof b !== "object") return null;
  const o = b as Record<string, unknown>;
  const supplier: SavedSupplier | null = o.supplier === undefined || o.supplier === "CJ" ? "CJ" : o.supplier === "ALIEXPRESS" ? "ALIEXPRESS" : null;
  const productId = cleanSavedId(o.productId);
  if (!supplier || !productId) return null;
  const image = typeof o.image === "string" && /^https:\/\//.test(o.image) ? o.image.slice(0, 500) : null;
  return {
    supplier,
    productId,
    title: text(o.title, 300),
    image,
    keyword: text(o.keyword, 120),
    marketId: typeof o.marketId === "string" && isMarketplaceId(o.marketId) ? (o.marketId as MarketplaceId) : null,
    price: num(o.price),
    cost: num(o.cost),
    profit: num(o.profit),
    marginPct: num(o.marginPct),
  };
}

/** Clé unique d'un produit sauvegardé (« CJ:123… »). */
export const savedKey = (supplier: string, productId: string) => `${supplier}:${productId}`;

export async function listSaved(userId: string) {
  return db.savedProduct.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: MAX_SAVED });
}

export async function savedKeys(userId: string): Promise<string[]> {
  const rows = await db.savedProduct.findMany({ where: { userId }, select: { supplier: true, productId: true }, take: MAX_SAVED });
  return rows.map((r) => savedKey(r.supplier, r.productId));
}

/**
 * Sauvegarde (ou met à jour) un produit. Les champs vides ne remplacent pas ce qui est déjà enregistré,
 * pour qu'une sauvegarde depuis l'extension (sans chiffres) n'efface pas l'instantané du Sniper.
 */
export async function saveProduct(userId: string, input: SaveInput) {
  const key = { userId_supplier_productId: { userId, supplier: input.supplier, productId: input.productId } };
  const exists = await db.savedProduct.findUnique({ where: key });
  if (!exists && (await db.savedProduct.count({ where: { userId } })) >= MAX_SAVED) throw new SavedError("SAVED_FULL");
  const { supplier, productId, ...fields } = input;
  const filled = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null));
  return db.savedProduct.upsert({
    where: key,
    create: { userId, supplier, productId, ...fields },
    update: filled,
  });
}

/** Retire un produit, ou tous (all). Renvoie le nombre de lignes supprimées. */
export async function removeSaved(userId: string, target: { supplier?: SavedSupplier; productId: string } | "all") {
  const where = target === "all" ? { userId } : { userId, productId: target.productId, ...(target.supplier ? { supplier: target.supplier } : {}) };
  const r = await db.savedProduct.deleteMany({ where });
  return r.count;
}

/** Envoie les produits CJ sauvegardés (les plus récents, 50 au maximum) au Sniper pour une analyse à jour. */
export async function sendSavedToSniper(user: UserWithAccounts, marketIdRaw: unknown) {
  const items = await db.savedProduct.findMany({ where: { userId: user.id, supplier: "CJ" }, orderBy: { createdAt: "desc" }, take: MAX_IDEAS_PER_RUN });
  if (!items.length) throw new SavedError("SAVED_EMPTY");
  const marketId = typeof marketIdRaw === "string" && isMarketplaceId(marketIdRaw) ? marketIdRaw : marketplace(user.defaultMarketplace).id;
  const run = await createRun(user, {
    mode: "CATALOG",
    marketId,
    target: items.length,
    seeds: [],
    autoList: false,
    products: items.map((i) => ({ productId: i.productId, title: i.title })),
  });
  return { runId: run.id, count: items.length };
}
