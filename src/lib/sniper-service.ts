/**
 * Sniper (côté serveur) : crée une recherche, puis l'avance par petites étapes (quelques produits à la fois),
 * appelées par le navigateur tant que la page est ouverte, et par la tâche planifiée sinon.
 *
 * Mode CATALOG : on parcourt les produits CJ stockés dans le pays (par thème), on dérive la recherche eBay
 * du titre, puis on vérifie la vraie demande eBay (ventes estimées) et la marge après tous les frais.
 * Mode KEYWORDS : on teste chaque mot-clé fourni avec le chercheur habituel.
 * Option : les produits rentables sont mis en vente automatiquement (mêmes contrôles qu'une mise en vente manuelle).
 */
import type { Prisma, SnipeCandidate, SnipeRun, User } from "@prisma/client";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { searchWithDemand } from "@/lib/ebay";
import { findProduct } from "@/lib/finder";
import { getUsdRates, offersToCurrency } from "@/lib/fx";
import { ListingError, prepareListing, publishListing } from "@/lib/listing-service";
import { evaluateProduct, weightedMedian, type SupplierOffer } from "@/lib/margin";
import { marketplace, type MarketplaceId } from "@/lib/marketplaces";
import * as cj from "@/lib/suppliers/cj";
import {
  classify, DEFAULT_SEEDS, isFinished, keywordFromTitle, MAX_TARGET, MAX_VARIANTS, maxScan, MIN_UNITS_SOLD, RESUME_AFTER_MS,
} from "@/lib/sniper";

type UserWithAccounts = User & {
  ebayAccounts: { id: string; accessToken: string; accessTokenExpires: Date; refreshToken: string; refreshTokenExpires: Date }[];
  supplierAccounts: { id?: string; supplier: string; accessToken: string; refreshToken?: string | null; expiresAt?: Date | null }[];
};

export type SnipeErrorCode = "PLAN_REQUIRED" | "CJ_REQUIRED" | "SNIPE_RUNNING" | "EBAY_NOT_CONNECTED" | "INVALID_INPUT" | "NOT_FOUND";
export class SnipeError extends Error {
  constructor(readonly code: SnipeErrorCode) {
    super(code);
  }
}

export interface CreateInput {
  mode: "CATALOG" | "KEYWORDS";
  marketId: MarketplaceId;
  target: number;
  minMarginPct?: number;
  priceMin?: number | null;
  priceMax?: number | null;
  seeds: string[];          // thèmes (CATALOG) ou mots-clés à tester (KEYWORDS)
  autoList: boolean;
  ebayAccountId?: string | null;
}

/** Arrêt de la mise en vente automatique pour toute la recherche (inutile de réessayer à chaque produit). */
const STOP_AUTO_LIST = new Set(["DAILY_LIMIT", "PLAN_LIMIT", "EBAY_SETUP_REQUIRED", "GPSR_REQUIRED", "EBAY_NOT_CONNECTED", "EBAY_RECONNECT", "PLAN_REQUIRED"]);
/** Trop d'échecs d'affilée : la recherche s'arrête (fournisseur ou eBay en panne, clé invalide…). */
const MAX_CONSECUTIVE_ERRORS = 5;
const LOCK_MS = 90_000;

const cjToken = (user: UserWithAccounts) => {
  const acc = user.supplierAccounts.find((a) => a.supplier === "CJ");
  return acc ? decrypt(acc.accessToken) : null;
};

export async function createRun(user: UserWithAccounts, input: CreateInput) {
  if (user.plan === "NONE") throw new SnipeError("PLAN_REQUIRED");
  if (!cjToken(user)) throw new SnipeError("CJ_REQUIRED");
  const target = Math.max(1, Math.min(MAX_TARGET, Math.floor(input.target)));
  if (input.mode === "KEYWORDS" && input.seeds.length === 0) throw new SnipeError("INVALID_INPUT");
  if (input.priceMin != null && input.priceMax != null && input.priceMin > input.priceMax) throw new SnipeError("INVALID_INPUT");
  const account = input.autoList ? user.ebayAccounts.find((a) => a.id === input.ebayAccountId) ?? user.ebayAccounts[0] : null;
  if (input.autoList && !account) throw new SnipeError("EBAY_NOT_CONNECTED");
  const running = await db.snipeRun.count({ where: { userId: user.id, status: "RUNNING" } });
  if (running > 0) throw new SnipeError("SNIPE_RUNNING");

  const run = await db.snipeRun.create({
    data: {
      userId: user.id,
      mode: input.mode,
      marketplace: marketplace(input.marketId).id,
      target,
      // Jamais sous le seuil de marge du compte.
      minMarginPct: Math.max(user.minMarginPct, input.minMarginPct ?? 0),
      priceMin: input.priceMin ?? null,
      priceMax: input.priceMax ?? null,
      autoList: Boolean(account),
      ebayAccountId: account?.id ?? null,
      seeds: input.seeds,
      ...(input.mode === "CATALOG" ? { cursor: { round: 1, seed: 0, exhausted: false } } : {}),
    },
  });
  if (input.mode === "KEYWORDS") {
    await db.snipeCandidate.createMany({ data: input.seeds.map((keyword) => ({ runId: run.id, keyword })) });
  }
  return run;
}

export async function stopRun(userId: string, runId: string) {
  const r = await db.snipeRun.updateMany({ where: { id: runId, userId, status: "RUNNING" }, data: { status: "STOPPED", lockedUntil: null } });
  return r.count > 0;
}

interface Cursor { round: number; seed: number; exhausted: boolean }

interface CjListItem { id?: string; pid?: string; nameEn?: string; productNameEn?: string; productName?: string }

/** Page suivante du catalogue CJ (thème par thème, page par page) → nouveaux produits à analyser. */
async function gather(run: RunRow, token: string): Promise<Cursor> {
  const m = marketplace(run.marketplace);
  const custom = Array.isArray(run.seeds) ? (run.seeds as string[]).filter(Boolean) : [];
  const seeds = custom.length ? custom : DEFAULT_SEEDS;
  const cur: Cursor = { round: 1, seed: 0, exhausted: false, ...((run.cursor as Partial<Cursor> | null) ?? {}) };
  const MAX_ROUNDS = 5;

  const data = (await cj.searchProducts(token, seeds[cur.seed], cur.round, 20, m.country)) as { content?: { productList?: CjListItem[] }[]; list?: CjListItem[] };
  const items = (data.content?.[0]?.productList ?? data.list ?? []).filter((it) => it.id ?? it.pid);

  // Thème suivant ; après le dernier thème, page suivante de chacun.
  const next: Cursor = cur.seed + 1 < seeds.length ? { ...cur, seed: cur.seed + 1 } : { ...cur, seed: 0, round: cur.round + 1 };
  if (next.round > MAX_ROUNDS) next.exhausted = true;

  if (items.length) {
    const ids = items.map((it) => String(it.id ?? it.pid));
    const [known, listed] = await Promise.all([
      db.snipeCandidate.findMany({ where: { runId: run.id, productId: { in: ids } }, select: { productId: true } }),
      db.listing.findMany({ where: { userId: run.userId, supplier: "CJ", supplierProductId: { in: ids }, status: { in: ["ACTIVE", "PAUSED", "DRAFT"] } }, select: { supplierProductId: true } }),
    ]);
    const skip = new Set([...known.map((k) => k.productId), ...listed.map((l) => l.supplierProductId)]);
    const fresh = items.filter((it) => !skip.has(String(it.id ?? it.pid)));
    if (fresh.length) {
      await db.snipeCandidate.createMany({
        data: fresh.map((it) => {
          const title = it.nameEn ?? it.productNameEn ?? it.productName ?? "";
          const keyword = keywordFromTitle(title);
          return {
            runId: run.id,
            supplier: "CJ" as const,
            productId: String(it.id ?? it.pid),
            title: title.slice(0, 300) || null,
            keyword: keyword || "—",
            ...(keyword ? {} : { status: "REJECTED" as const, reason: "NO_KEYWORD" }),
          };
        }),
      });
    }
  }
  return next;
}

/** Offres pour un produit CJ : les variantes en stock dans le pays (les moins chères), avec la livraison la moins chère. */
async function cjOffersFor(token: string, product: cj.CjProduct, country: string): Promise<SupplierOffer[]> {
  const inStock = product.variants
    .map((v) => ({ v, stock: v.inventories?.find((i) => i.countryCode === country)?.totalInventory ?? 0 }))
    .filter((x) => x.stock > 0)
    .sort((a, b) => Number(a.v.variantSellPrice) - Number(b.v.variantSellPrice))
    .slice(0, MAX_VARIANTS);
  const offers: SupplierOffer[] = [];
  for (const { v, stock } of inStock) {
    const options = await cj.freightCalculate(token, v.vid, 1, country);
    if (!options.length) continue;
    const cheapest = options.reduce((a, b) => (b.logisticPrice < a.logisticPrice ? b : a));
    offers.push({
      supplier: "CJ",
      productId: product.pid,
      variantId: v.vid,
      title: `${product.productNameEn}${v.variantKey ? ` — ${v.variantKey}` : ""}`,
      price: Number(v.variantSellPrice),
      shipping: Number(cheapest.logisticPrice),
      stockUs: stock,
      deliveryDaysMax: cj.parseMaxDays(cheapest.logisticAging),
    });
  }
  return offers;
}

type RunRow = SnipeRun;

/** Analyse d'un produit ou d'un mot-clé → données à enregistrer sur le candidat. */
async function evaluate(run: RunRow, c: SnipeCandidate, token: string): Promise<Prisma.SnipeCandidateUpdateInput> {
  const m = marketplace(run.marketplace);
  const toMarket = async (offers: SupplierOffer[]) => (m.currency === "USD" ? offers : offersToCurrency(offers, m.currency, await getUsdRates()));

  if (run.mode === "KEYWORDS") {
    const r = await findProduct(c.keyword, { cjToken: token, minMarginPct: run.minMarginPct, marketId: m.id });
    const k = classify(r, { unitsSold: r.unitsSold, priceMin: run.priceMin, priceMax: run.priceMax, title: r.best?.title });
    return {
      status: k.status,
      reason: k.reason ?? null,
      supplier: r.best?.supplier ?? null,
      productId: r.best?.productId ?? null,
      variantId: r.best?.variantId ?? null,
      title: r.best?.title?.slice(0, 300) ?? null,
      marketPrice: r.marketPrice,
      cost: r.margin?.landedCost ?? null,
      profit: r.margin?.profit ?? null,
      marginPct: r.margin?.marginPct ?? null,
      unitsSold: r.unitsSold,
      deliveryDaysMax: r.best?.deliveryDaysMax ?? null,
    };
  }

  // CATALOG : stock local d'abord (1 appel), puis demande eBay, et seulement ensuite les frais de port.
  const product = await cj.getProduct(token, c.productId!);
  const image = cj.productImages(product)[0] ?? null;
  const title = product.productNameEn || c.title;
  const base = { title: title?.slice(0, 300) ?? null, image };
  const hasStock = product.variants.some((v) => (v.inventories?.find((i) => i.countryCode === m.country)?.totalInventory ?? 0) > 0);
  if (!hasStock) return { ...base, status: "REJECTED", reason: "NO_SUPPLIER" };

  const market = await searchWithDemand(c.keyword, 10, m.id);
  const sold = weightedMedian(market.soldWeighted);
  const prices = sold !== null ? [sold] : market.prices;
  // Pas d'annonce comparable ou pas de ventes : inutile d'interroger les frais de port.
  if (!prices.length) return { ...base, status: "REJECTED", reason: "NO_PRICE", unitsSold: market.unitsSold };
  if (market.unitsSold < MIN_UNITS_SOLD) {
    return { ...base, status: "REJECTED", reason: "NO_DEMAND", marketPrice: evaluateProduct(prices, [], run.minMarginPct, { market: m }).marketPrice, unitsSold: market.unitsSold };
  }
  const offers = await toMarket(await cjOffersFor(token, product, m.country));
  const e = evaluateProduct(prices, offers, run.minMarginPct, { market: m });
  const k = classify(e, { unitsSold: market.unitsSold, priceMin: run.priceMin, priceMax: run.priceMax, title });
  return {
    ...base,
    status: k.status,
    reason: k.reason ?? null,
    variantId: e.best?.variantId ?? null,
    marketPrice: e.marketPrice,
    cost: e.margin?.landedCost ?? null,
    profit: e.margin?.profit ?? null,
    marginPct: e.margin?.marginPct ?? null,
    unitsSold: market.unitsSold,
    deliveryDaysMax: e.best?.deliveryDaysMax ?? null,
  };
}

/** Mise en vente automatique d'un produit rentable (brouillon IA puis publication, avec tous les contrôles habituels). */
async function autoList(user: UserWithAccounts, run: RunRow, c: { keyword: string; supplier: "CJ" | "ALIEXPRESS"; productId: string; variantId: string | null }) {
  const m = marketplace(run.marketplace);
  const draft = await prepareListing(user, { keyword: c.keyword, marketId: m.id, ref: { supplier: c.supplier, productId: c.productId, variantId: c.variantId ?? undefined } });
  if (draft.vero) throw new ListingError("LISTING_BLOCKED", draft.vero);
  if (draft.missingRequired.length) throw new ListingError("ASPECTS_MISSING", draft.missingRequired.join(", "));
  return publishListing(user, {
    ebayAccountId: run.ebayAccountId!,
    marketId: m.id,
    ref: draft.ref,
    categoryId: draft.categoryId,
    title: draft.title,
    descriptionHtml: draft.descriptionHtml,
    aspects: draft.aspects,
    price: draft.suggestedPrice,
    quantity: draft.quantity,
    keyword: c.keyword,
  });
}

/**
 * Avance une recherche jusqu'à `deadline` (ms). Un seul traitement à la fois par recherche (verrou).
 * Renvoie false si la recherche était déjà en cours de traitement ailleurs.
 */
export async function advanceRun(runId: string, deadline: number): Promise<boolean> {
  const now = Date.now();
  const lock = await db.snipeRun.updateMany({
    where: { id: runId, status: "RUNNING", OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date(now) } }] },
    data: { lockedUntil: new Date(now + LOCK_MS) },
  });
  if (lock.count === 0) return false;

  let run = (await db.snipeRun.findUnique({ where: { id: runId } }))!;
  const user = (await db.user.findUnique({
    where: { id: run.userId },
    include: { ebayAccounts: { orderBy: { createdAt: "asc" } }, supplierAccounts: true },
  })) as UserWithAccounts | null;
  const token = user ? cjToken(user) : null;
  if (!user || !token || user.plan === "NONE") {
    await db.snipeRun.update({ where: { id: runId }, data: { status: "FAILED", error: !user || user.plan === "NONE" ? "PLAN_REQUIRED" : "CJ_REQUIRED", lockedUntil: null } });
    return true;
  }

  let errorsInARow = 0;
  let failed: string | null = null;
  try {
    while (Date.now() < deadline && run.found < run.target) {
      const c = await db.snipeCandidate.findFirst({ where: { runId, status: "PENDING" }, orderBy: { createdAt: "asc" } });
      if (!c) {
        const cur = run.cursor as Partial<Cursor> | null;
        if (run.mode === "CATALOG" && !cur?.exhausted && run.scanned < maxScan(run.target)) {
          const next = await gather(run, token);
          run = await db.snipeRun.update({ where: { id: runId }, data: { cursor: { ...next } } });
          continue;
        }
        break;
      }

      let update: Prisma.SnipeCandidateUpdateInput;
      try {
        update = await evaluate(run, c, token);
        errorsInARow = 0;
      } catch (e) {
        console.error("Sniper", c.keyword, e);
        update = { status: "ERROR", reason: "UPSTREAM" };
        if (++errorsInARow >= MAX_CONSECUTIVE_ERRORS) failed = "UPSTREAM";
      }

      // Mise en vente automatique des produits rentables.
      if (update.status === "PROFITABLE" && run.autoList && run.ebayAccountId) {
        const productId = (update.productId as string | null | undefined) ?? c.productId;
        const supplier = ((update.supplier as string | null | undefined) ?? c.supplier) as "CJ" | "ALIEXPRESS" | null;
        const variantId = (update.variantId as string | null | undefined) ?? c.variantId;
        if (productId && supplier) {
          try {
            const r = await autoList(user, run, { keyword: c.keyword, supplier, productId, variantId });
            update = { ...update, status: "LISTED", listingId: r.id };
          } catch (e) {
            const code = e instanceof ListingError ? e.code : "UPSTREAM";
            update = { ...update, reason: `AUTO_LIST:${code}` };
            if (STOP_AUTO_LIST.has(code)) run = await db.snipeRun.update({ where: { id: runId }, data: { autoList: false, error: code } });
          }
        }
      }

      await db.snipeCandidate.update({ where: { id: c.id }, data: update });
      const good = update.status === "PROFITABLE" || update.status === "LISTED";
      run = await db.snipeRun.update({
        where: { id: runId },
        data: { scanned: { increment: 1 }, ...(good ? { found: { increment: 1 } } : {}), ...(update.status === "LISTED" ? { listed: { increment: 1 } } : {}) },
      });
      if (failed) break;
    }
  } catch (e) {
    console.error("Sniper", runId, e);
    failed = "UPSTREAM";
  }

  const pending = await db.snipeCandidate.count({ where: { runId, status: "PENDING" } });
  const exhausted = Boolean((run.cursor as Partial<Cursor> | null)?.exhausted);
  const done = isFinished({ mode: run.mode, target: run.target, found: run.found, scanned: run.scanned, pending, exhausted });
  // Arrêtée par le vendeur pendant le traitement : on ne la relance pas.
  const current = await db.snipeRun.findUnique({ where: { id: runId }, select: { status: true } });
  await db.snipeRun.update({
    where: { id: runId },
    data: {
      lockedUntil: null,
      lastStepAt: new Date(),
      ...(current?.status === "RUNNING" && failed ? { status: "FAILED", error: failed } : {}),
      ...(current?.status === "RUNNING" && !failed && done ? { status: "DONE" } : {}),
    },
  });
  return true;
}

/** Tâche planifiée : reprend les recherches que plus aucun navigateur ne fait avancer. */
export async function advanceAll(deadline: number): Promise<number> {
  const stale = new Date(Date.now() - RESUME_AFTER_MS);
  const runs = await db.snipeRun.findMany({
    where: { status: "RUNNING", OR: [{ lastStepAt: null }, { lastStepAt: { lt: stale } }] },
    orderBy: { createdAt: "asc" },
    take: 20,
    select: { id: true },
  });
  let n = 0;
  for (const r of runs) {
    if (Date.now() > deadline - 10_000) break;
    if (await advanceRun(r.id, Math.min(deadline, Date.now() + 60_000))) n++;
  }
  return n;
}

/** État d'une recherche pour l'écran : compteurs + produits (rentables d'abord). */
export async function runState(userId: string, runId: string) {
  const run = await db.snipeRun.findFirst({ where: { id: runId, userId } });
  if (!run) return null;
  const candidates = await db.snipeCandidate.findMany({
    where: { runId, status: { not: "PENDING" } },
    orderBy: { createdAt: "asc" },
    take: 300,
  });
  const order = { LISTED: 0, PROFITABLE: 1, REJECTED: 2, ERROR: 3, PENDING: 4 } as const;
  candidates.sort((a, b) => order[a.status] - order[b.status] || (b.profit ?? 0) - (a.profit ?? 0));
  return {
    id: run.id,
    mode: run.mode,
    marketId: run.marketplace as MarketplaceId,
    status: run.status,
    target: run.target,
    scanned: run.scanned,
    found: run.found,
    listed: run.listed,
    maxScan: run.mode === "CATALOG" ? maxScan(run.target) : (run.seeds as string[]).length,
    autoList: run.autoList,
    error: run.error,
    createdAt: run.createdAt.toISOString(),
    candidates: candidates.map((c) => ({
      id: c.id,
      keyword: c.keyword,
      supplier: c.supplier,
      productId: c.productId,
      variantId: c.variantId,
      title: c.title,
      image: c.image,
      status: c.status,
      reason: c.reason,
      marketPrice: c.marketPrice,
      cost: c.cost,
      profit: c.profit,
      marginPct: c.marginPct,
      unitsSold: c.unitsSold,
      deliveryDaysMax: c.deliveryDaysMax,
      listingId: c.listingId,
    })),
  };
}

export type RunState = NonNullable<Awaited<ReturnType<typeof runState>>>;
