import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ setup: true as boolean, updates: [] as unknown[], createRun: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    ebayMarketSetup: { findUnique: vi.fn(async () => (mocks.setup ? { id: "S" } : null)) },
    user: { update: vi.fn(async ({ data }: { data: unknown }) => { mocks.updates.push(data); }) },
  },
}));
vi.mock("@/lib/sniper-service", () => {
  class SnipeError extends Error { constructor(readonly code: string) { super(code); } }
  return { createRun: mocks.createRun, SnipeError };
});

import { autopilotDue, runAutopilot } from "./autopilot";
import { SnipeError } from "@/lib/sniper-service";

const now = Date.parse("2026-10-02T12:00:00Z");
const user = (over: Record<string, unknown> = {}) => ({ id: "U1", plan: "PRO", defaultMarketplace: "EBAY_US", autopilot: true, autopilotPerDay: 50, autopilotCategories: ["kitchen", "nope"], ebayAccounts: [{ id: "ACC" }], supplierAccounts: [], ...over }) as never;

beforeEach(() => {
  mocks.setup = true;
  mocks.updates = [];
  mocks.createRun.mockReset().mockResolvedValue({ id: "R1" });
});

describe("pilote automatique", () => {
  it("une fois par jour, seulement si activé avec un forfait", () => {
    expect(autopilotDue({ autopilot: true, plan: "PRO", autopilotLastRunAt: null }, now)).toBe(true);
    expect(autopilotDue({ autopilot: true, plan: "PRO", autopilotLastRunAt: new Date(now - 3600_000) }, now)).toBe(false);
    expect(autopilotDue({ autopilot: true, plan: "PRO", autopilotLastRunAt: new Date(now - 25 * 3600_000) }, now)).toBe(true);
    expect(autopilotDue({ autopilot: false, plan: "PRO", autopilotLastRunAt: null }, now)).toBe(false);
    expect(autopilotDue({ autopilot: true, plan: "NONE", autopilotLastRunAt: null }, now)).toBe(false);
  });

  it("lance le Sniper avec publication automatique, plafonné à 20 par jour, catégories valides seulement", async () => {
    expect(await runAutopilot(user(), now)).toBe("STARTED");
    expect(mocks.createRun).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ mode: "CATALOG", target: 20, autoList: true, categories: ["kitchen"], ebayAccountId: "ACC" }));
    expect(mocks.updates).toEqual([{ autopilotLastRunAt: new Date(now) }]);
  });

  it("sans réglages eBay : rien n'est lancé ; recherche déjà en cours : réessai plus tard ; plus de CJ : pilote coupé", async () => {
    mocks.setup = false;
    expect(await runAutopilot(user(), now)).toBe("EBAY_SETUP_REQUIRED");
    expect(mocks.createRun).not.toHaveBeenCalled();
    mocks.setup = true;
    mocks.updates = [];
    mocks.createRun.mockRejectedValueOnce(new SnipeError("SNIPE_RUNNING" as never));
    expect(await runAutopilot(user(), now)).toBe("BUSY");
    expect(mocks.updates).toEqual([]);
    mocks.createRun.mockRejectedValueOnce(new SnipeError("CJ_REQUIRED" as never));
    expect(await runAutopilot(user(), now)).toBe("CJ_REQUIRED");
    expect(mocks.updates).toEqual([{ autopilotLastRunAt: new Date(now), autopilot: false }]);
  });
});
