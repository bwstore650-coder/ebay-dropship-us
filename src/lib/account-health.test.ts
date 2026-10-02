import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: {} }));
import { healthAlerts, limitUsage, riskyOrders } from "./account-health";

const H = 3_600_000;
const now = Date.parse("2026-10-02T12:00:00Z");
const ord = (id: string, status: string, ageH: number, extra: { orderedAgoH?: number; tracking?: string } = {}) => ({
  id, ebayOrderId: `E-${id}`, status, createdAt: new Date(now - ageH * H),
  orderedAt: extra.orderedAgoH !== undefined ? new Date(now - extra.orderedAgoH * H) : null, trackingNumber: extra.tracking ?? null,
});

describe("protection du compte", () => {
  it("ventes à risque : pas commandée après 12 h, pas de suivi 3 jours après la commande", () => {
    const r = riskyOrders([
      ord("A", "PENDING", 2),                        // récente : ok
      ord("B", "NEEDS_REVIEW", 20),                  // à commander vite
      ord("C", "ORDERED", 100, { orderedAgoH: 80 }), // pas de suivi
      ord("D", "ORDERED", 100, { orderedAgoH: 80, tracking: "9400" }),
      ord("E", "ORDERED", 30, { orderedAgoH: 20 }),  // trop tôt pour s'inquiéter
    ], now);
    expect(r.map((x) => [x.id, x.reason])).toEqual([["C", "NO_TRACKING"], ["B", "NOT_ORDERED"]]);
  });
  it("part de la limite de vente utilisée", () => {
    const u = limitUsage({ amount: 1000, currency: "USD", quantity: 10 }, [{ price: 20, quantity: 3 }, { price: 50, quantity: 5 }]);
    expect(u.quantity).toEqual({ used: 8, limit: 10, share: 0.8 });
    expect(u.amount).toEqual({ used: 310, limit: 1000, share: 0.31, currency: "USD" });
    expect(limitUsage(null, []).quantity).toBeNull();
  });
  it("alertes, de la plus grave à la moins grave", () => {
    const a = healthAlerts({
      standards: { level: "BELOW_STANDARD", program: "PROGRAM_US", evaluatedAt: null, metrics: [] },
      usage: { quantity: { used: 9, limit: 10, share: 0.9 }, amount: null },
      risks: [{ id: "B", ebayOrderId: "E", status: "PENDING", hours: 20, reason: "NOT_ORDERED" }],
      needsReconnect: true,
    });
    expect(a.map((x) => x.kind)).toEqual(["BELOW_STANDARD", "NOT_ORDERED", "LIMIT", "RECONNECT"]);
    expect(healthAlerts({ standards: { level: "TOP_RATED", program: "PROGRAM_US", evaluatedAt: null, metrics: [] }, usage: null, risks: [], needsReconnect: false })).toEqual([]);
  });
});
