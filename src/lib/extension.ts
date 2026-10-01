/**
 * Extension navigateur Sellvela : connexion par jeton, résumé du compte (popup, badge, notifications),
 * analyse d'un produit CJ, liste d'idées, calculateur de frais et vérification de marque.
 * Toute la logique reste ici, côté serveur : l'extension ne fait qu'afficher.
 */
import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { findVeroBrand } from "@/lib/compliance";
import { computeMargin, priceForTargetMargin } from "@/lib/margin";
import { marketplace, type MarketplaceId } from "@/lib/marketplaces";
import { analyzeCatalogProduct, minPriceFor, POOL_FRESH_MS, savePool, type Analysis } from "@/lib/product-pool";
import { totals } from "@/lib/affiliate";
import * as cj from "@/lib/suppliers/cj";

/* ---------- Jetons ---------- */

export const TOKEN_PREFIX = "svx_";
/** Jetons actifs au maximum par compte (un par navigateur) ; au-delà, les plus anciens sont retirés. */
export const MAX_TOKENS_PER_USER = 5;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Nouveau jeton pour l'extension. Seule son empreinte est gardée en base : il n'est visible qu'une fois. */
export async function createExtensionToken(userId: string, label?: string | null): Promise<string> {
  const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  await db.extensionToken.create({ data: { userId, tokenHash: hashToken(token), label: label?.slice(0, 80) ?? null } });
  const all = await db.extensionToken.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, select: { id: true } });
  const extra = all.slice(MAX_TOKENS_PER_USER).map((t) => t.id);
  if (extra.length) await db.extensionToken.deleteMany({ where: { id: { in: extra } } });
  return token;
}

const USER_INCLUDE = { ebayAccounts: { orderBy: { createdAt: "asc" as const } }, supplierAccounts: true };
export type ExtUser = Prisma.UserGetPayload<{ include: typeof USER_INCLUDE }>;

/** Utilisateur de l'extension (en-tête « Authorization: Bearer svx_… »), ou null. */
export async function extensionUser(req: Request): Promise<ExtUser | null> {
  const h = req.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!token.startsWith(TOKEN_PREFIX) || token.length > 200) return null;
  const row = await db.extensionToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: { include: USER_INCLUDE } } });
  if (!row) return null;
  // Dernière utilisation (au plus une écriture par heure).
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 3600_000) {
    await db.extensionToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  }
  return row.user;
}

/* ---------- Solde CJ ---------- */

/** Solde CJ jugé bas en dessous de ce montant, ou s'il ne couvre pas les commandes en attente. */
export const LOW_BALANCE_USD = 50;
const BALANCE_CACHE_MS = 10 * 60_000;

export function balanceIsLow(balance: number, pendingCost: number): boolean {
  return balance < Math.max(LOW_BALANCE_USD, pendingCost);
}

async function cjBalance(user: ExtUser): Promise<number | null> {
  const acc = user.supplierAccounts.find((a) => a.supplier === "CJ");
  if (!acc) return null;
  const key = `cjbal:${user.id}`;
  const hit = await db.appState.findUnique({ where: { key } });
  if (hit?.expiresAt && hit.expiresAt.getTime() > Date.now()) return (hit.value as { balance: number }).balance;
  try {
    const balance = await cj.getBalance(decrypt(acc.accessToken));
    const expiresAt = new Date(Date.now() + BALANCE_CACHE_MS);
    await db.appState.upsert({ where: { key }, create: { key, value: { balance }, expiresAt }, update: { value: { balance }, expiresAt } });
    return balance;
  } catch (e) {
    console.error("Solde CJ", e);
    return null;
  }
}

/* ---------- Résumé (popup, badge, notifications) ---------- */

export interface ExtEvent {
  id: string;
  kind: "SALE" | "ORDER_BLOCKED";
  title: string;
  amount: number | null;
  currency: string;
  at: string;
}

const MAX_EVENTS = 20;

export async function extensionSummary(user: ExtUser, since: Date | null) {
  const attention = ["NEEDS_REVIEW", "FAILED"] as const;
  const [ordersToCheck, pausedListings, openReturns, listings, pending, commissions, sales, blocked] = await Promise.all([
    db.order.count({ where: { userId: user.id, status: { in: [...attention] } } }),
    db.listing.count({ where: { userId: user.id, status: "PAUSED" } }),
    db.afterSale.count({ where: { userId: user.id, open: true } }),
    db.listing.count({ where: { userId: user.id } }),
    // Commandes pas encore payées chez le fournisseur : le solde CJ doit les couvrir.
    db.order.findMany({ where: { userId: user.id, status: "PENDING" }, select: { supplierCost: true } }),
    db.commission.findMany({ where: { affiliateId: user.id }, select: { amountCents: true, status: true, availableAt: true } }),
    since
      ? db.order.findMany({ where: { userId: user.id, createdAt: { gt: since } }, orderBy: { createdAt: "desc" }, take: MAX_EVENTS, include: { listing: { select: { title: true } } } })
      : Promise.resolve([]),
    since
      ? db.order.findMany({ where: { userId: user.id, status: { in: [...attention] }, updatedAt: { gt: since } }, orderBy: { updatedAt: "desc" }, take: MAX_EVENTS, include: { listing: { select: { title: true } } } })
      : Promise.resolve([]),
  ]);
  const balance = await cjBalance(user);
  const pendingCost = Math.round(pending.reduce((s, o) => s + (o.supplierCost ?? 0), 0) * 100) / 100;
  const t = totals(commissions);
  const events: ExtEvent[] = [
    ...sales.map((o) => ({ id: `sale:${o.id}`, kind: "SALE" as const, title: o.listing?.title ?? o.ebayOrderId, amount: o.saleTotal, currency: o.currency, at: o.createdAt.toISOString() })),
    ...blocked.map((o) => ({ id: `blocked:${o.id}:${o.status}`, kind: "ORDER_BLOCKED" as const, title: o.listing?.title ?? o.ebayOrderId, amount: o.saleTotal, currency: o.currency, at: o.updatedAt.toISOString() })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_EVENTS);
  const app = env().APP_URL.replace(/\/+$/, "");

  return {
    user: { email: user.email, plan: user.plan, locale: user.locale, marketId: marketplace(user.defaultMarketplace).id, minMarginPct: user.minMarginPct },
    cj: { connected: user.supplierAccounts.some((a) => a.supplier === "CJ"), balance, pendingCost, low: balance !== null && balanceIsLow(balance, pendingCost) },
    counts: { ordersToCheck, pausedListings, openReturns },
    onboarding: {
      plan: user.plan !== "NONE",
      ebay: user.ebayAccounts.length > 0,
      supplier: user.supplierAccounts.length > 0,
      firstListing: listings > 0,
    },
    referral: {
      link: user.referralCode ? `${app}/?ref=${user.referralCode}` : null,
      pendingCents: t.pendingCents,
      payableCents: t.payableCents,
      paidCents: t.paidCents,
    },
    events,
    now: new Date().toISOString(),
  };
}

/* ---------- Analyse d'un produit CJ ---------- */

export type ExtError = "PLAN_REQUIRED" | "CJ_REQUIRED" | "INVALID_INPUT" | "NOT_FOUND" | "RATE_LIMITED";

/** Analyses en direct par vendeur et par heure (chacune coûte des appels eBay et CJ). Les analyses déjà en base ne comptent pas. */
export const LIVE_ANALYSES_PER_HOUR = 60;

async function takeAnalysisSlot(userId: string): Promise<boolean> {
  const hour = Math.floor(Date.now() / 3600_000);
  const key = `extan:${userId}:${hour}`;
  const row = await db.appState.findUnique({ where: { key } });
  const used = (row?.value as { n?: number } | undefined)?.n ?? 0;
  if (used >= LIVE_ANALYSES_PER_HOUR) return false;
  const expiresAt = new Date((hour + 1) * 3600_000);
  await db.appState.upsert({ where: { key }, create: { key, value: { n: used + 1 }, expiresAt }, update: { value: { n: used + 1 } } });
  return true;
}
export class ExtensionError extends Error {
  constructor(readonly code: ExtError) {
    super(code);
  }
}

/** Identifiant produit CJ valide (lettres, chiffres, tirets ; jamais une URL entière). */
export function cleanProductId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return /^[A-Za-z0-9-]{6,64}$/.test(v) ? v : null;
}

export interface ExtAnalysis {
  productId: string;
  marketId: MarketplaceId;
  title: string | null;
  image: string | null;
  keyword: string | null;
  status: "PROFITABLE" | "REJECTED";
  reason: string | null;
  marketPrice: number | null;
  cost: number | null;
  fees: number | null;
  profit: number | null;
  marginPct: number | null;
  minPrice: number | null;
  minMarginPct: number; // marge minimum du vendeur (celle utilisée pour le verdict et le prix minimum)
  stock: number | null;
  deliveryDaysMax: number | null;
  vero: string | null; // marque protégée détectée dans le titre
  currency: string;
  analyzedAt: string;
  createUrl: string; // page Sellvela pour créer l'annonce
}

function toExt(a: Analysis & { keyword?: string | null }, productId: string, marketId: MarketplaceId, minMarginPct: number, analyzedAt: Date): ExtAnalysis {
  const m = marketplace(marketId);
  const d = a.details ?? {};
  // Marge propre au vendeur : un produit rentable à 30 % peut ne pas l'être à 40 %.
  const ok = a.status === "PROFITABLE" && (a.marginPct ?? -Infinity) >= minMarginPct;
  const reason = a.status === "PROFITABLE" && !ok ? "LOW_MARGIN" : a.reason;
  const app = env().APP_URL.replace(/\/+$/, "");
  return {
    productId,
    marketId: m.id,
    title: a.title,
    image: a.image,
    keyword: a.keyword ?? null,
    status: ok ? "PROFITABLE" : "REJECTED",
    reason: ok ? null : reason,
    marketPrice: a.marketPrice,
    cost: a.cost,
    fees: d.fees ?? null,
    profit: a.profit,
    marginPct: a.marginPct,
    minPrice: a.cost !== null ? minPriceFor({ cost: a.cost }, minMarginPct, m.id) : d.minPrice ?? null,
    minMarginPct,
    stock: d.stock ?? null,
    deliveryDaysMax: a.deliveryDaysMax,
    vero: a.title ? findVeroBrand(a.title) : null,
    currency: m.currency,
    analyzedAt: analyzedAt.toISOString(),
    createUrl: `${app}/products/cj/${encodeURIComponent(productId)}?m=${m.id}`,
  };
}

/** Analyse un produit CJ : réutilise la base commune si l'analyse a moins de 24 h, sinon l'analyse en direct. */
export async function analyzeForExtension(user: ExtUser, productId: string, marketId?: string | null): Promise<ExtAnalysis> {
  if (user.plan === "NONE") throw new ExtensionError("PLAN_REQUIRED");
  const acc = user.supplierAccounts.find((a) => a.supplier === "CJ");
  if (!acc) throw new ExtensionError("CJ_REQUIRED");
  const m = marketplace((marketId as MarketplaceId) || user.defaultMarketplace);
  const pooled = await db.productInsight.findUnique({
    where: { marketplace_supplier_productId: { marketplace: m.id, supplier: "CJ", productId } },
  });
  if (pooled && Date.now() - pooled.analyzedAt.getTime() < POOL_FRESH_MS) {
    const a: Analysis & { keyword: string } = {
      status: pooled.reason ? "REJECTED" : "PROFITABLE",
      reason: pooled.reason,
      title: pooled.title,
      image: pooled.image,
      variantId: pooled.variantId,
      marketPrice: pooled.marketPrice,
      cost: pooled.cost,
      profit: pooled.profit,
      marginPct: pooled.marginPct,
      unitsSold: pooled.unitsSold,
      deliveryDaysMax: pooled.deliveryDaysMax,
      details: (pooled.details ?? {}) as Analysis["details"],
      keyword: pooled.keyword,
    };
    return toExt(a, productId, m.id, user.minMarginPct, pooled.analyzedAt);
  }
  if (!(await takeAnalysisSlot(user.id))) throw new ExtensionError("RATE_LIMITED");
  const a = await analyzeCatalogProduct(decrypt(acc.accessToken), m.id, productId, "", null, { minMarginPct: user.minMarginPct });
  if (a.keyword) await savePool(m.id, productId, a.keyword, a).catch((e) => console.error("Pool", e));
  return toExt(a, productId, m.id, user.minMarginPct, new Date());
}

/* ---------- Calculateur de frais ---------- */

export function feeCalculator(i: { price: number; cost: number; shipping?: number; marketId?: string | null; minMarginPct: number }) {
  const m = marketplace((i.marketId as MarketplaceId) || "EBAY_US");
  const r = computeMargin({ saleTotal: i.price, supplierCost: i.cost, supplierShipping: i.shipping ?? 0, market: m });
  let minPrice: number | null = null;
  try {
    minPrice = priceForTargetMargin(r.landedCost, i.minMarginPct, { market: m });
  } catch {
    minPrice = null;
  }
  return { ...r, minPrice, currency: m.currency, marketId: m.id };
}

/* ---------- Vérification de marque ---------- */

export function brandCheck(text: string) {
  const brand = findVeroBrand(text.slice(0, 500));
  return { brand, risky: brand !== null };
}
