import { beforeEach, describe, expect, it, vi } from "vitest";

const q = vi.hoisted(() => ({ used: 0, limit: 300 }));
vi.mock("@/lib/ai-quota", () => ({
  takeAiCredit: vi.fn(async () => {
    if (q.used >= q.limit) throw new Error("AI_LIMIT");
    q.used++;
  }),
  refundAiCredit: vi.fn(async () => { q.used--; }),
  aiUsage: vi.fn(async () => ({ used: q.used, limit: q.limit, unlimited: false })),
}));

import { generate } from "./ai-service";

const u = { id: "U1", plan: "PRO" as const };
const ctx = { language: "en" as const, productTitle: "Electric can opener", facts: "ABS body, 4 AA batteries, one-touch" };

beforeEach(() => {
  q.used = 0; q.limit = 300;
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("générations IA à la demande", () => {
  it("titres : quota compté et renvoyé", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: [{ type: "tool_use", input: { titles: ["Electric Can Opener One Touch Automatic"] } }] }))));
    expect(await generate(u, { kind: "titles", context: ctx })).toEqual({ titles: ["Electric Can Opener One Touch Automatic"], usage: { used: 1, limit: 300, unlimited: false } });
  });
  it("description nettoyée (pas de script ni de lien)", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: [{ type: "tool_use", input: { description_html: '<p>Great opener</p><script>x()</script><a href="https://x">link</a>' } }] }))));
    const r = await generate(u, { kind: "description", context: ctx });
    expect(r.descriptionHtml).toContain("Great opener");
    expect(r.descriptionHtml).not.toMatch(/<script|href=/);
  });
  it("refus : sans formule, sans clé, quota atteint ; échec de l'IA = génération rendue", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    await expect(generate({ id: "U2", plan: "NONE" }, { kind: "titles", context: ctx })).rejects.toMatchObject({ code: "PLAN_REQUIRED" });
    q.used = 300;
    await expect(generate(u, { kind: "titles", context: ctx })).rejects.toMatchObject({ code: "AI_LIMIT" });
    q.used = 5;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("down", { status: 529 })));
    await expect(generate(u, { kind: "titles", context: ctx })).rejects.toMatchObject({ code: "AI_FAILED" });
    expect(q.used).toBe(5);
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    await expect(generate(u, { kind: "titles", context: ctx })).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" });
  });
});
