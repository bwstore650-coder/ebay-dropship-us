import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createRun: vi.fn(async () => ({ id: "RUN1" })),
  endListing: vi.fn(async () => undefined),
  monitorUser: vi.fn(async () => ({})),
  listings: [{ id: "L1", title: "Can opener", price: 19.99, currency: "USD", quantity: 3, status: "PAUSED", pauseReason: "OUT_OF_STOCK", lastMarginPct: 31, marketplace: "EBAY_US", groupKey: null }],
}));
vi.mock("@/lib/db", () => ({
  db: {
    listing: { findMany: vi.fn(async () => mocks.listings), groupBy: vi.fn(async () => []) },
    order: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock("@/lib/sniper-service", () => ({ createRun: mocks.createRun }));
vi.mock("@/lib/listing-service", () => ({ endListing: mocks.endListing }));
vi.mock("@/lib/monitor-service", () => ({ monitorUser: mocks.monitorUser }));
vi.mock("@/lib/finder", () => ({ findProduct: vi.fn() }));
vi.mock("@/lib/account-health", () => ({ accountHealth: vi.fn() }));
vi.mock("@/lib/crypto", () => ({ decrypt: (s: string) => s }));

import { cleanHistory, executeAction, parseAction, runAssistant } from "./assistant";

const user = { id: "U1", plan: "PRO", minMarginPct: 30, defaultMarketplace: "EBAY_US", ebayAccounts: [], supplierAccounts: [] } as never;
const json = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: { "content-type": "application/json" } });
let bodies: { messages: { role: string; content: unknown }[]; tools: { name: string }[] }[] = [];

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "k");
  bodies = [];
  vi.clearAllMocks();
});

describe("assistant", () => {
  it("historique nettoyé : commence par le vendeur, rôles alternés, textes bornés", () => {
    expect(cleanHistory([{ role: "assistant", content: "salut" }, { role: "user", content: "a" }, { role: "user", content: "b" }, { role: "system", content: "x" }, { role: "assistant", content: "c".repeat(3000) }]))
      .toEqual([{ role: "user", content: "a\nb" }, { role: "assistant", content: "c".repeat(2000) }]);
    expect(cleanHistory("nope")).toEqual([]);
  });

  it("lit les vraies données avec un outil, puis répond", async () => {
    const replies = [
      { content: [{ type: "tool_use", id: "t1", name: "list_listings", input: { status: "PAUSED" } }], stop_reason: "tool_use" },
      { content: [{ type: "text", text: "1 annonce en pause : Can opener (rupture)." }], stop_reason: "end_turn" },
    ];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return json(replies.shift()); }));
    const r = await runAssistant(user, [{ role: "user", content: "Quelles annonces sont en pause ?" }], "fr");
    expect(r).toEqual({ reply: "1 annonce en pause : Can opener (rupture).", pending: null, usedTools: ["list_listings"] });
    const toolResult = bodies[1].messages.at(-1)!.content as { type: string; content: string }[];
    expect(toolResult[0].type).toBe("tool_result");
    expect(JSON.parse(toolResult[0].content)[0]).toMatchObject({ id: "L1", status: "PAUSED", variations: false });
    expect(bodies[0].tools.map((t) => t.name)).toContain("start_product_search");
  });

  it("une action est proposée, jamais exécutée par l'IA", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ content: [{ type: "text", text: "Je lance 10 produits cuisine, confirme." }, { type: "tool_use", id: "t2", name: "start_product_search", input: { target: 10, categories: ["kitchen"], autoList: true } }], stop_reason: "tool_use" })));
    const r = await runAssistant(user, [{ role: "user", content: "Trouve et publie 10 produits cuisine" }], "fr");
    expect(r.pending).toMatchObject({ tool: "start_product_search", args: { target: 10, categories: ["kitchen"], keywords: [], autoList: true } });
    expect(mocks.createRun).not.toHaveBeenCalled();
  });

  it("action confirmée : exécutée avec des paramètres vérifiés", async () => {
    expect(parseAction("start_product_search", { target: 999, autoList: true })).toBeNull();
    expect(parseAction("delete_everything", {})).toBeNull();
    const a = parseAction("start_product_search", { target: 5, keywords: ["led strip"], autoList: false })!;
    expect(await executeAction(user, a.tool, a.args)).toEqual({ ok: true, code: "SNIPER_STARTED", runId: "RUN1" });
    expect(mocks.createRun).toHaveBeenCalledWith(user, expect.objectContaining({ mode: "KEYWORDS", target: 5, seeds: ["led strip"], autoList: false }));
    mocks.endListing.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "NOT_FOUND" }));
    expect(await executeAction(user, "end_listing", { listingId: "L9" })).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await executeAction(user, "check_listings_now", {})).toEqual({ ok: true, code: "CHECKED" });
    expect(mocks.monitorUser).toHaveBeenCalledWith(user, { force: true });
  });
});
