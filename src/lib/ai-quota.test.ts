import { beforeEach, describe, expect, it, vi } from "vitest";

const mem = vi.hoisted(() => ({ rows: new Map<string, number>() }));
vi.mock("@/lib/db", () => ({
  db: {
    aiUsage: {
      findUnique: vi.fn(async ({ where }: { where: { userId_month: { userId: string; month: string } } }) => {
        const k = `${where.userId_month.userId}:${where.userId_month.month}`;
        return mem.rows.has(k) ? { count: mem.rows.get(k) } : null;
      }),
      upsert: vi.fn(async ({ where }: { where: { userId_month: { userId: string; month: string } } }) => {
        const k = `${where.userId_month.userId}:${where.userId_month.month}`;
        mem.rows.set(k, (mem.rows.get(k) ?? 0) + 1);
        return { count: mem.rows.get(k) };
      }),
      update: vi.fn(async ({ where }: { where: { userId_month: { userId: string; month: string } } }) => {
        const k = `${where.userId_month.userId}:${where.userId_month.month}`;
        mem.rows.set(k, mem.rows.get(k)! - 1);
      }),
      updateMany: vi.fn(async ({ where }: { where: { userId: string; month: string } }) => {
        const k = `${where.userId}:${where.month}`;
        if ((mem.rows.get(k) ?? 0) > 0) mem.rows.set(k, mem.rows.get(k)! - 1);
        return { count: 1 };
      }),
    },
  },
}));

import { AI_FAIR_USE, aiLimit, aiUsage, monthKey, refundAiCredit, takeAiCredit } from "./ai-quota";
import { PLANS } from "./plans";

beforeEach(() => mem.rows.clear());

describe("quota IA", () => {
  it("limites par formule (Agency : illimité avec plafond de sécurité, sans formule : 0)", () => {
    expect(PLANS.map((p) => p.aiPerMonth)).toEqual([300, 1000, 5000, null]);
    expect(aiLimit("STARTER")).toEqual({ limit: 300, unlimited: false });
    expect(aiLimit("AGENCY")).toEqual({ limit: AI_FAIR_USE, unlimited: true });
    expect(aiLimit("NONE")).toEqual({ limit: 0, unlimited: false });
  });
  it("compte par mois, refuse au-delà de la limite sans dépasser, rend une génération ratée", async () => {
    const u = { id: "U1", plan: "STARTER" as const };
    mem.rows.set(`U1:${monthKey()}`, 299);
    await takeAiCredit(u);
    expect(await aiUsage(u)).toMatchObject({ used: 300, limit: 300 });
    await expect(takeAiCredit(u)).rejects.toMatchObject({ message: "AI_LIMIT", limit: 300 });
    expect((await aiUsage(u)).used).toBe(300); // le refus n'est pas compté
    await refundAiCredit(u);
    expect((await aiUsage(u)).used).toBe(299);
    await expect(takeAiCredit({ id: "U2", plan: "NONE" })).rejects.toMatchObject({ message: "AI_LIMIT" });
  });
  it("clé du mois en UTC", () => {
    expect(monthKey(new Date("2026-10-31T23:30:00Z"))).toBe("2026-10");
  });
});
