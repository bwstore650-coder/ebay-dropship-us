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
import { findProduct } from "@/lib/finder";
import { isQuotaError } from "@/lib/ebay";
import { pauseForQuota, quotaPausedUntil } from "@/lib/ebay-quota";
import { ListingError, prepareListing, publishListing } from "@/lib/listing-service";
import { marketplace, type MarketplaceId } from "@/lib/marketplaces";
import * as cj from "@/lib/suppliers/cj";
import { analyzeCatalogProduct, minPriceFor, pickFromPool, POOL_FRESH_MS, savePool } from "@/lib/product-pool";
import {
  type CandidateDetails,
  classify, DEFAULT_SEEDS, HIGH_TICKET_PROFIT, HIGH_TICKET_SEEDS, isFinished, keywordFromTitle, MAX_TARGET, maxScan, RESUME_AFTER_MS,
} from "@/lib/sniper";

export type UserWithAccounts = User & {
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
  highTicket?: boolean;     // produits chers : au moins HIGH_TICKET_PROFIT de profit par vente
  /** Produits précis à analyser (liste d'idées de l'extension) : pas de parcours du catalogue. */
  products?: { productId: string; title?: string | null }[];
}

/** Nombre maximum de produits envoyés d'un coup depuis la liste d'idées. */
export const MAX_IDEAS_PER_RUN = 50;

/** Arrêt de la mise en vente automatique pour toute la recherche (inutile de réessayer à chaque produit). */
const STOP_AUTO_LIST = new Set(["DAILY_LIMIT", "PLAN_LIMIT", "EBAY_SETUP_REQUIRED", "GPSR_REQUIRED", "EBAY_NOT_CONNECTED", "EBAY_RECONNECT", "PLAN_REQUIRED"]);
/** Trop d'échecs d'affilée : la recherche s'arrête (fournisseur ou eBay en panne, clé invalide…). */
const MAX_CONSECUTIVE_ERRORS = 5;
/** Erreur affichée (recherche en pause) quand le quota eBay du jour est atteint. */
export const QUOTA_ERROR = "EBAY_QUOTA";
/** Âge maximum des données eBay affichées (contrat de licence API eBay). */
export const EBAY_DATA_MAX_AGE_MS = 24 * 3600_000;
const LOCK_MS = 90_000;

const cjToken = (user: UserWithAccounts) => {
  const acc = user.supplierAccounts.find((a) => a.supplier === "CJ");
  return acc ? decrypt(acc.accessToken) : null;
};

export async function createRun(user: UserWithAccounts, input: CreateInput) {
  if (user.plan === "NONE") throw new SnipeError("PLAN_REQUIRED");
  if (!cjToken(user)) throw new SnipeError("CJ_REQUIRED");
  const products = input.mode === "CATALOG" && input.products?.length ? input.products.slice(0, MAX_IDEAS_PER_RUN) : null;
  const target = products ? products.length : Math.max(1, Math.min(MAX_TARGET, Math.floor(input.target)));
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
      minProfit: input.highTicket ? HIGH_TICKET_PROFIT : null,
      priceMin: input.priceMin ?? null,
      priceMax: input.priceMax ?? null,
      autoList: Boolean(account),
      ebayAccountId: account?.id ?? null,
      seeds: input.seeds,
      // Liste de produits précis : rien d'autre à parcourir (« exhausted »).
      ...(input.mode === "CATALOG" ? { cursor: { round: 1, seed: 0, exhausted: Boolean(products) } } : {}),
    },
  });
  if (input.mode === "KEYWORDS") {
    await db.snipeCandidate.createMany({ data: input.seeds.map((keyword) => ({ runId: run.id, keyword })) });
  } else if (products) {
    // Le mot-clé eBay est déduit du titre fournisseur pendant l'analyse.
    await db.snipeCandidate.createMany({
      data: products.map((p) => ({ runId: run.id, supplier: "CJ" as const, productId: p.productId, title: p.title?.slice(0, 300) ?? null, keyword: "" })),
    });
  } else {
    await prefillFromPool(run);
  }
  return run;
}

/**
 * Produits rentables déjà analysés (base commune) : ajoutés tout de suite à la recherche.
 * Avec la mise en vente automatique, ils sont revérifiés en direct avant publication (statut « à analyser »).
 */
async function prefillFromPool(run: SnipeRun): Promise<number> {
  const need = run.target - run.found;
  if (run.mode !== "CATALOG" || need <= 0) return 0;
  try {
    const [listed, seen] = await Promise.all([
      db.listing.findMany({ where: { userId: run.userId, supplier: "CJ", status: { in: ["ACTIVE", "PAUSED", "DRAFT"] } }, select: { supplierProductId: true } }),
      db.snipeCandidate.findMany({ where: { runId: run.id }, select: { productId: true } }),
    ]);
    const custom = Array.isArray(run.seeds) ? (run.seeds as string[]).filter(Boolean) : [];
    const rows = await pickFromPool({
      userId: run.userId,
      marketId: run.marketplace as MarketplaceId,
      minMarginPct: run.minMarginPct,
      minProfit: run.minProfit,
      priceMin: run.priceMin,
      priceMax: run.priceMax,
      themes: custom,
      exclude: [...listed.map((l) => l.supplierProductId), ...seen.map((c) => c.productId).filter((x): x is string => Boolean(x))],
      limit: need,
    });
    if (!rows.length) return 0;
    if (run.autoList) {
      await db.snipeCandidate.createMany({ data: rows.map((r) => ({ runId: run.id, supplier: "CJ" as const, productId: r.productId, title: r.title, keyword: r.keyword })) });
      return 0;
    }
    await db.snipeCandidate.createMany({
      data: rows.map((r) => {
        const d = (r.details ?? {}) as CandidateDetails;
        return {
          runId: run.id,
          supplier: "CJ" as const,
          productId: r.productId,
          variantId: r.variantId,
          keyword: r.keyword,
          title: r.title,
          image: r.image,
          status: "PROFITABLE" as const,
          marketPrice: r.marketPrice,
          cost: r.cost,
          profit: r.profit,
          marginPct: r.marginPct,
          unitsSold: r.unitsSold,
          deliveryDaysMax: r.deliveryDaysMax,
          analyzedAt: r.analyzedAt,
          details: toJson({ ...d, minPrice: minPriceFor(r, run.minMarginPct, run.marketplace as MarketplaceId) ?? d.minPrice ?? null }),
        };
      }),
    });
    const found = run.found + rows.length;
    await db.snipeRun.update({
      where: { id: run.id },
      data: { found, scanned: { increment: rows.length }, ...(found >= run.target ? { status: "DONE" } : {}) },
    });
    return rows.length;
  } catch (e) {
    console.error("Pool", run.id, e);
    return 0;
  }
}

export async function stopRun(userId: string, runId: string) {
  const r = await db.snipeRun.updateMany({ where: { id: runId, userId, status: "RUNNING" }, data: { status: "STOPPED", lockedUntil: null } });
  return r.count > 0;
}

/**
 * « Continuer la recherche » : une recherche du catalogue terminée (limite atteinte), arrêtée ou en erreur
 * repart là où elle s'était arrêtée, avec un nouveau lot de produits à analyser.
 */
export async function continueRun(userId: string, runId: string): Promise<"OK" | "NOT_FOUND" | "EXHAUSTED"> {
  const run = await db.snipeRun.findFirst({ where: { id: runId, userId } });
  if (!run || run.mode !== "CATALOG" || run.status === "RUNNING") return "NOT_FOUND";
  if ((run.cursor as Partial<Cursor> | null)?.exhausted) return "EXHAUSTED";
  // Produits restés en erreur (panne passagère) : on les réessaie (ils ne comptent plus comme analysés).
  const retried = await db.snipeCandidate.updateMany({ where: { runId, status: "ERROR" }, data: { status: "PENDING", reason: null } });
  const scanned = Math.max(0, run.scanned - retried.count);
  await db.snipeRun.update({
    where: { id: runId },
    data: {
      scanned,
      status: "RUNNING",
      error: null,
      lockedUntil: null,
      lastStepAt: null,
      target: Math.max(run.target, run.found + 1),
      scanLimit: scanned + maxScan(run.target),
    },
  });
  const updated = await db.snipeRun.findUnique({ where: { id: runId } });
  if (updated) await prefillFromPool(updated);
  return "OK";
}

interface Cursor { round: number; seed: number; exhausted: boolean }

interface CjListItem { id?: string; pid?: string; nameEn?: string; productNameEn?: string; productName?: string }

/** Page suivante du catalogue CJ (thème par thème, page par page) → nouveaux produits à analyser. */
async function gather(run: RunRow, token: string): Promise<Cursor> {
  const m = marketplace(run.marketplace);
  const custom = Array.isArray(run.seeds) ? (run.seeds as string[]).filter(Boolean) : [];
  const seeds = custom.length ? custom : run.minProfit != null ? HIGH_TICKET_SEEDS : DEFAULT_SEEDS;
  const cur: Cursor = { round: 1, seed: 0, exhausted: false, ...((run.cursor as Partial<Cursor> | null) ?? {}) };
  const MAX_ROUNDS = 20;

  const data = (await cj.searchProducts(token, seeds[cur.seed], cur.round, 20, m.country)) as { content?: { productList?: CjListItem[] }[]; list?: CjListItem[] };
  const items = (data.content?.[0]?.productList ?? data.list ?? []).filter((it) => it.id ?? it.pid);

  // Thème suivant ; après le dernier thème, page suivante de chacun.
  const next: Cursor = cur.seed + 1 < seeds.length ? { ...cur, seed: cur.seed + 1 } : { ...cur, seed: 0, round: cur.round + 1 };
  if (next.round > MAX_ROUNDS) next.exhausted = true;

  if (items.length) {
    const ids = items.map((it) => String(it.id ?? it.pid));
    const [known, listed, pooled] = await Promise.all([
      db.snipeCandidate.findMany({ where: { runId: run.id, productId: { in: ids } }, select: { productId: true } }),
      db.listing.findMany({ where: { userId: run.userId, supplier: "CJ", supplierProductId: { in: ids }, status: { in: ["ACTIVE", "PAUSED", "DRAFT"] } }, select: { supplierProductId: true } }),
      // Déjà analysés récemment dans la base commune : les rentables ont été proposés d'office, inutile de refaire l'analyse.
      run.autoList
        ? Promise.resolve([] as { productId: string }[])
        : db.productInsight.findMany({ where: { marketplace: run.marketplace, supplier: "CJ", productId: { in: ids }, analyzedAt: { gt: new Date(Date.now() - POOL_FRESH_MS) } }, select: { productId: true } }),
    ]);
    const skip = new Set([...known.map((k) => k.productId), ...listed.map((l) => l.supplierProductId), ...pooled.map((p) => p.productId)]);
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

type RunRow = SnipeRun;

const toJson = (d: CandidateDetails) => d as unknown as Prisma.InputJsonValue;

/** Analyse d'un produit ou d'un mot-clé → données à enregistrer sur le candidat. */
async function evaluate(run: RunRow, c: SnipeCandidate, token: string): Promise<Prisma.SnipeCandidateUpdateInput> {
  const m = marketplace(run.marketplace);
  if (run.mode === "KEYWORDS") {
    const r = await findProduct(c.keyword, { cjToken: token, minMarginPct: run.minMarginPct, marketId: m.id });
    const k = classify(r, { unitsSold: r.unitsSold, priceMin: run.priceMin, priceMax: run.priceMax, title: r.best?.title, minProfit: run.minProfit });
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
      details: toJson({
        market: r.insights,
        supplierPrice: r.best?.price ?? null,
        shipping: r.best?.shipping ?? null,
        fees: r.margin?.fees ?? null,
        stock: r.best?.stockUs ?? null,
        minPrice: r.minPriceForTarget,
      }),
    };
  }

  // CATALOG : analyse complète, enregistrée aussi dans la base commune (sert aux recherches suivantes).
  const a = await analyzeCatalogProduct(token, m.id, c.productId!, c.keyword, c.title, { minMarginPct: run.minMarginPct, minProfit: run.minProfit, priceMin: run.priceMin, priceMax: run.priceMax });
  const keyword = a.keyword || c.keyword;
  if (keyword) await savePool(m.id, c.productId!, keyword, a).catch((e) => console.error("Pool", e));
  return {
    keyword,
    title: a.title,
    image: a.image,
    status: a.status,
    reason: a.reason,
    variantId: a.variantId,
    marketPrice: a.marketPrice,
    cost: a.cost,
    profit: a.profit,
    marginPct: a.marginPct,
    unitsSold: a.unitsSold,
    deliveryDaysMax: a.deliveryDaysMax,
    details: toJson(a.details),
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

  // Quota eBay atteint : la recherche attend la remise à zéro (elle reste « en cours » et reprend toute seule).
  if (await quotaPausedUntil()) {
    await db.snipeRun.update({ where: { id: runId }, data: { error: QUOTA_ERROR, lockedUntil: null, lastStepAt: new Date() } });
    return true;
  }
  if (run.error === QUOTA_ERROR) run = await db.snipeRun.update({ where: { id: runId }, data: { error: null } });

  let errorsInARow = 0;
  let failed: string | null = null;
  let quotaHit = false;
  try {
    while (Date.now() < deadline && run.found < run.target) {
      const c = await db.snipeCandidate.findFirst({ where: { runId, status: "PENDING" }, orderBy: { createdAt: "asc" } });
      if (!c) {
        const cur = run.cursor as Partial<Cursor> | null;
        if (run.mode === "CATALOG" && !cur?.exhausted && run.scanned < (run.scanLimit ?? maxScan(run.target))) {
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
        if (isQuotaError(e)) {
          // Le produit reste à analyser : il sera repris après la pause.
          quotaHit = true;
          break;
        }
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

      await db.snipeCandidate.update({ where: { id: c.id }, data: { ...update, analyzedAt: new Date() } });
      const good = update.status === "PROFITABLE" || update.status === "LISTED";
      run = await db.snipeRun.update({
        where: { id: runId },
        data: { scanned: { increment: 1 }, ...(good ? { found: { increment: 1 } } : {}), ...(update.status === "LISTED" ? { listed: { increment: 1 } } : {}) },
      });
      if (failed) break;
    }
  } catch (e) {
    if (isQuotaError(e)) quotaHit = true;
    else {
      console.error("Sniper", runId, e);
      failed = "UPSTREAM";
    }
  }
  if (quotaHit) {
    await pauseForQuota();
    await db.snipeRun.update({ where: { id: runId }, data: { error: QUOTA_ERROR, lockedUntil: null, lastStepAt: new Date() } });
    return true;
  }

  const pending = await db.snipeCandidate.count({ where: { runId, status: "PENDING" } });
  const exhausted = Boolean((run.cursor as Partial<Cursor> | null)?.exhausted);
  const done = isFinished({ mode: run.mode, target: run.target, found: run.found, scanned: run.scanned, pending, exhausted, scanLimit: run.scanLimit });
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
    minMarginPct: run.minMarginPct,
    minProfit: run.minProfit,
    scanned: run.scanned,
    found: run.found,
    listed: run.listed,
    maxScan: run.mode === "CATALOG" ? run.scanLimit ?? maxScan(run.target) : (run.seeds as string[]).length,
    exhausted: Boolean((run.cursor as Partial<Cursor> | null)?.exhausted),
    autoList: run.autoList,
    error: run.error,
    pausedUntil: run.status === "RUNNING" && run.error === QUOTA_ERROR ? ((await quotaPausedUntil())?.toISOString() ?? null) : null,
    createdAt: run.createdAt.toISOString(),
    candidates: candidates.map((c) => {
      // Contrat eBay : pas de données eBay de plus de 24 h à l'écran (prix, ventes, frais et profit qui en découlent).
      const expired = Date.now() - (c.analyzedAt ?? c.createdAt).getTime() > EBAY_DATA_MAX_AGE_MS && c.status !== "PENDING";
      const details = (c.details ?? null) as CandidateDetails | null;
      return {
      id: c.id,
      keyword: c.keyword,
      supplier: c.supplier,
      productId: c.productId,
      variantId: c.variantId,
      title: c.title,
      image: c.image,
      status: c.status,
      reason: c.reason,
      marketPrice: expired ? null : c.marketPrice,
      cost: c.cost,
      profit: expired ? null : c.profit,
      marginPct: expired ? null : c.marginPct,
      unitsSold: expired ? 0 : c.unitsSold,
      deliveryDaysMax: c.deliveryDaysMax,
      details: expired && details ? { ...details, market: undefined, fees: undefined } : details,
      listingId: c.listingId,
      expired,
      };
    }),
  };
}

export type RunState = NonNullable<Awaited<ReturnType<typeof runState>>>;
