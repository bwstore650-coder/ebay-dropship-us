/**
 * Assistant Sellvela : un chat qui répond avec les vraies données du vendeur (outils de lecture) et prépare
 * des actions (recherche Sniper, retrait d'annonce, vérification du stock). Une action n'est JAMAIS exécutée
 * par l'IA : elle est proposée au vendeur, qui la confirme d'un clic (executeAction).
 */
import { z } from "zod";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { aiModel } from "@/lib/ai";
import { accountHealth } from "@/lib/account-health";
import { COUNTED } from "@/lib/dashboard";
import { findProduct } from "@/lib/finder";
import { endListing } from "@/lib/listing-service";
import { marketplace, type MarketplaceId } from "@/lib/marketplaces";
import { monitorUser } from "@/lib/monitor-service";
import { CATEGORY_IDS, MAX_TARGET } from "@/lib/sniper";
import { createRun, type UserWithAccounts } from "@/lib/sniper-service";

export const MAX_TURNS = 20;          // messages gardés dans la conversation
export const MAX_MESSAGE = 2000;      // caractères par message
const MAX_STEPS = 6;                  // appels d'outils par réponse
const DAY = 86_400_000;

export interface ChatMessage { role: "user" | "assistant"; content: string }
export interface PendingAction { tool: ActionName; args: Record<string, unknown>; summary: string }
export interface AssistantReply { reply: string; pending: PendingAction | null; usedTools: string[] }

type Tool = { name: string; description: string; input_schema: Record<string, unknown> };

const READ_TOOLS: Tool[] = [
  {
    name: "store_summary",
    description: "Sales, net profit, orders and listings of the seller over the last N days (7, 30 or 90). Use it for any question about sales, profit or how the store is doing.",
    input_schema: { type: "object", properties: { days: { type: "integer", enum: [7, 30, 90] } }, required: ["days"] },
  },
  {
    name: "list_listings",
    description: "The seller's listings, optionally filtered by status (ACTIVE, PAUSED, DRAFT, ENDED, ERROR) and by words in the title. Returns id, title, price, quantity, status, pause reason, last margin.",
    input_schema: { type: "object", properties: { status: { type: "string", enum: ["ACTIVE", "PAUSED", "DRAFT", "ENDED", "ERROR"] }, search: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 20 } } },
  },
  {
    name: "list_orders",
    description: "The seller's recent orders, optionally filtered by status (PENDING, ORDERED, SHIPPED, NEEDS_REVIEW, FAILED, CANCELLED). Returns eBay order id, status, total, profit, problem code, date.",
    input_schema: { type: "object", properties: { status: { type: "string", enum: ["PENDING", "ORDERING", "ORDERED", "SHIPPED", "NEEDS_REVIEW", "FAILED", "CANCELLED"] }, limit: { type: "integer", minimum: 1, maximum: 20 } } },
  },
  {
    name: "account_health",
    description: "eBay account protection: seller level, selling-limit usage, sales at risk of late shipment, alerts.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "analyze_product",
    description: "Checks whether a product (search keyword in English, e.g. 'electric can opener') is profitable on eBay: market price, cheapest fast supplier offer stocked locally, margin and verdict.",
    input_schema: { type: "object", properties: { keyword: { type: "string", minLength: 2, maxLength: 120 } }, required: ["keyword"] },
  },
];

const ACTION_TOOLS: Tool[] = [
  {
    name: "start_product_search",
    description: "PROPOSES to start the Product Sniper: it scans the supplier catalog and keeps profitable products; with autoList it also lists them on eBay. The seller must confirm. Categories: " + CATEGORY_IDS.join(", ") + ".",
    input_schema: {
      type: "object",
      properties: {
        target: { type: "integer", minimum: 1, maximum: MAX_TARGET },
        categories: { type: "array", items: { type: "string", enum: CATEGORY_IDS }, maxItems: 3 },
        keywords: { type: "array", items: { type: "string" }, maxItems: 10 },
        autoList: { type: "boolean" },
      },
      required: ["target", "autoList"],
    },
  },
  {
    name: "end_listing",
    description: "PROPOSES to end (remove from eBay) one listing, by its id from list_listings. The seller must confirm.",
    input_schema: { type: "object", properties: { listingId: { type: "string" } }, required: ["listingId"] },
  },
  {
    name: "check_listings_now",
    description: "PROPOSES to check stock and supplier prices of all listings right now (pauses out-of-stock items, resumes restocked ones). The seller must confirm.",
    input_schema: { type: "object", properties: {} },
  },
];

export type ActionName = "start_product_search" | "end_listing" | "check_listings_now";
const ACTION_NAMES = new Set<string>(ACTION_TOOLS.map((t) => t.name));

const actionSchemas = {
  start_product_search: z.object({
    target: z.number().int().min(1).max(MAX_TARGET),
    categories: z.array(z.enum(CATEGORY_IDS as [string, ...string[]])).max(3).default([]),
    keywords: z.array(z.string().trim().min(2).max(80)).max(10).default([]),
    autoList: z.boolean(),
  }),
  end_listing: z.object({ listingId: z.string().min(1).max(64) }),
  check_listings_now: z.object({}),
} as const;

const LANGS: Record<string, string> = { en: "English", fr: "French", de: "German", es: "Spanish", it: "Italian" };

function systemPrompt(user: UserWithAccounts, locale: string): string {
  const m = marketplace(user.defaultMarketplace);
  return `You are the Sellvela assistant, inside Sellvela, an eBay dropshipping app (suppliers: CJdropshipping, AliExpress; products stocked in local warehouses, delivered in 8 days or less).
You help ONE seller with THEIR store. Today: ${new Date().toISOString().slice(0, 10)}. Main eBay site: ${m.id} (${m.currency}). Minimum margin: ${user.minMarginPct} %. Plan: ${user.plan}.

Rules:
- Answer in the language the seller writes in (default ${LANGS[locale] ?? "English"}). Be short and concrete: a few sentences or a short list. Plain text only: no Markdown headings, tables or ** bold; simple "- " bullets are fine.
- Never invent numbers, products or orders: use the tools. If a tool fails or returns nothing, say so.
- To DO something (start a product search, end a listing, check stock now), call the matching action tool. It is NOT executed: the seller sees a Confirm button. Say clearly what will happen and that they need to confirm. Propose at most one action per answer.
- You cannot: change account settings, connect accounts, enter passwords or card numbers, contact buyers, or spend money. Point to the right page instead (Settings, Subscription, Orders, Listings, Product Sniper, Account protection).
- Never promise income. Dropshipping results vary.
- eBay policy: only suppliers that ship directly to the buyer from their own stock (no Amazon/Walmart retail arbitrage).`;
}

/* ---------- Outils de lecture ---------- */

async function runReadTool(user: UserWithAccounts, name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "store_summary": {
      const days = [7, 30, 90].includes(Number(input.days)) ? Number(input.days) : 30;
      const since = new Date(Date.now() - days * DAY);
      const [orders, byStatus] = await Promise.all([
        db.order.findMany({ where: { userId: user.id, createdAt: { gte: since } }, select: { status: true, currency: true, saleTotal: true, profit: true, fees: true, supplierCost: true } }),
        db.listing.groupBy({ by: ["status"], where: { userId: user.id }, _count: { _all: true } }),
      ]);
      const perCurrency: Record<string, { orders: number; revenue: number; profit: number; ebayFees: number; supplierCost: number }> = {};
      for (const o of orders) {
        if (!COUNTED.has(o.status)) continue;
        const c = (perCurrency[o.currency] ??= { orders: 0, revenue: 0, profit: 0, ebayFees: 0, supplierCost: 0 });
        c.orders++;
        c.revenue += o.saleTotal ?? 0;
        c.profit += o.profit ?? 0;
        c.ebayFees += o.fees ?? 0;
        c.supplierCost += o.supplierCost ?? 0;
      }
      for (const c of Object.values(perCurrency)) for (const k of ["revenue", "profit", "ebayFees", "supplierCost"] as const) c[k] = Math.round(c[k] * 100) / 100;
      const pending = orders.filter((o) => !COUNTED.has(o.status) && o.status !== "CANCELLED").length;
      return { days, perCurrency, ordersNotYetPlaced: pending, listingsByStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])) };
    }
    case "list_listings": {
      const status = typeof input.status === "string" ? input.status : undefined;
      const search = typeof input.search === "string" ? input.search.slice(0, 80) : undefined;
      const rows = await db.listing.findMany({
        where: { userId: user.id, ...(status ? { status: status as never } : {}), ...(search ? { title: { contains: search, mode: "insensitive" } } : {}) },
        orderBy: { updatedAt: "desc" },
        take: Math.min(20, Number(input.limit) || 10),
        select: { id: true, title: true, price: true, currency: true, quantity: true, status: true, pauseReason: true, lastMarginPct: true, marketplace: true, groupKey: true },
      });
      return rows.map((r) => ({ ...r, variations: Boolean(r.groupKey), groupKey: undefined }));
    }
    case "list_orders": {
      const status = typeof input.status === "string" ? input.status : undefined;
      return db.order.findMany({
        where: { userId: user.id, ...(status ? { status: status as never } : {}) },
        orderBy: { createdAt: "desc" },
        take: Math.min(20, Number(input.limit) || 10),
        select: { ebayOrderId: true, status: true, saleTotal: true, profit: true, currency: true, errorCode: true, trackingNumber: true, createdAt: true },
      });
    }
    case "account_health": {
      const m = marketplace(user.defaultMarketplace);
      const out = [];
      for (const a of user.ebayAccounts) {
        const h = await accountHealth(user.id, a, m.id);
        out.push({ account: a.id, sellerLevel: h.standards?.level ?? null, alerts: h.alerts, sellingLimitUsage: h.usage, salesAtRisk: h.risks.slice(0, 10) });
      }
      return out.length ? out : { error: "NO_EBAY_ACCOUNT" };
    }
    case "analyze_product": {
      const keyword = String(input.keyword ?? "").trim().slice(0, 120);
      if (keyword.length < 2) return { error: "INVALID_KEYWORD" };
      const cj = user.supplierAccounts.find((a) => a.supplier === "CJ");
      const r = await findProduct(keyword, { cjToken: cj ? decrypt(cj.accessToken) : undefined, minMarginPct: user.minMarginPct, marketId: user.defaultMarketplace as MarketplaceId });
      return {
        keyword, currency: r.currency, verdict: r.verdict, marketPrice: r.marketPrice, ebayListings: r.ebayListingsCount,
        bestOffer: r.best ? { supplier: r.best.supplier, title: r.best.title, price: r.best.price, shipping: r.best.shipping, deliveryDaysMax: r.best.deliveryDaysMax } : null,
        profitPerSale: r.margin?.profit ?? null, marginPct: r.margin?.marginPct ?? null, minPriceForTargetMargin: r.minPriceForTarget,
      };
    }
  }
  return { error: "UNKNOWN_TOOL" };
}

/* ---------- Actions (après confirmation du vendeur) ---------- */

export function parseAction(tool: string, args: unknown): { tool: ActionName; args: Record<string, unknown> } | null {
  if (!ACTION_NAMES.has(tool)) return null;
  const r = actionSchemas[tool as ActionName].safeParse(args ?? {});
  return r.success ? { tool: tool as ActionName, args: r.data as Record<string, unknown> } : null;
}

/** Exécute une action confirmée par le vendeur ; renvoie un code de résultat pour l'écran. */
export async function executeAction(user: UserWithAccounts, tool: ActionName, args: Record<string, unknown>): Promise<{ ok: true; code: string; runId?: string } | { ok: false; code: string }> {
  try {
    if (tool === "start_product_search") {
      const a = actionSchemas.start_product_search.parse(args);
      const run = await createRun(user, {
        mode: a.keywords.length ? "KEYWORDS" : "CATALOG",
        marketId: user.defaultMarketplace as MarketplaceId,
        target: a.target,
        seeds: a.keywords,
        categories: a.categories,
        autoList: a.autoList,
      });
      return { ok: true, code: "SNIPER_STARTED", runId: run.id };
    }
    if (tool === "end_listing") {
      const a = actionSchemas.end_listing.parse(args);
      await endListing(user, a.listingId);
      return { ok: true, code: "LISTING_ENDED" };
    }
    await monitorUser(user, { force: true });
    return { ok: true, code: "CHECKED" };
  } catch (e) {
    const code = e && typeof e === "object" && "code" in e && typeof (e as { code: unknown }).code === "string" ? (e as { code: string }).code : "UPSTREAM";
    if (code === "UPSTREAM") console.error("Assistant (action)", tool, e);
    return { ok: false, code };
  }
}

/** Résumé lisible d'une action proposée (langue de l'écran gérée côté client ; ici, des données). */
function summarize(tool: ActionName, args: Record<string, unknown>): string {
  return JSON.stringify({ tool, ...args });
}

/* ---------- Boucle de conversation ---------- */

type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
type ApiMessage = { role: "user" | "assistant"; content: string | unknown[] };

async function callClaude(system: string, messages: ApiMessage[]): Promise<{ content: Block[]; stop_reason: string }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("AI_NOT_CONFIGURED");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: aiModel(), max_tokens: 1200, system, tools: [...READ_TOOLS, ...ACTION_TOOLS], messages }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status} : ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as { content: Block[]; stop_reason: string };
}

/** Nettoie l'historique envoyé par le navigateur : rôles alternés, textes bornés, commence par le vendeur. */
export function cleanHistory(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const msgs = raw
    .filter((m): m is ChatMessage => !!m && typeof m === "object" && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim() !== "")
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE) }))
    .slice(-MAX_TURNS);
  const out: ChatMessage[] = [];
  for (const m of msgs) {
    if (!out.length && m.role !== "user") continue;
    if (out.length && out[out.length - 1].role === m.role) out[out.length - 1] = { ...m, content: `${out[out.length - 1].content}\n${m.content}` };
    else out.push(m);
  }
  return out;
}

export async function runAssistant(user: UserWithAccounts, history: ChatMessage[], locale: string): Promise<AssistantReply> {
  const system = systemPrompt(user, locale);
  const messages: ApiMessage[] = history.map((m) => ({ role: m.role, content: m.content }));
  const usedTools: string[] = [];
  let text = "";
  for (let step = 0; step < MAX_STEPS; step++) {
    const r = await callClaude(system, messages);
    text = r.content.filter((b): b is Extract<Block, { type: "text" }> => b.type === "text").map((b) => b.text).join("\n").trim();
    const uses = r.content.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use");
    if (!uses.length) return { reply: text, pending: null, usedTools };
    // Une action proposée : on s'arrête là, le vendeur confirme.
    const action = uses.find((u) => ACTION_NAMES.has(u.name));
    if (action) {
      const parsed = parseAction(action.name, action.input);
      return { reply: text, pending: parsed ? { ...parsed, summary: summarize(parsed.tool, parsed.args) } : null, usedTools: [...usedTools, action.name] };
    }
    messages.push({ role: "assistant", content: r.content });
    const results = [];
    for (const u of uses) {
      usedTools.push(u.name);
      let out: unknown;
      try {
        out = await runReadTool(user, u.name, u.input ?? {});
      } catch (e) {
        console.error("Assistant (outil)", u.name, e);
        out = { error: "TOOL_FAILED" };
      }
      results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out).slice(0, 12_000) });
    }
    messages.push({ role: "user", content: results });
  }
  return { reply: text, pending: null, usedTools };
}
