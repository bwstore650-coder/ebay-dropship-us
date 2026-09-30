/**
 * Retours et annulations de bout en bout (base de données, eBay et CJ simulés).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const mem = vi.hoisted(() => ({ sales: [] as Row[], orders: [] as Row[], seq: 0 }));

function match(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, cond]) => {
    const v = row[k];
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>;
      if ("in" in c) return (c.in as unknown[]).includes(v);
      if ("notIn" in c) return !(c.notIn as unknown[]).includes(v);
      if ("gte" in c) return v instanceof Date && v >= (c.gte as Date);
    }
    return v === cond;
  });
}

vi.mock("@/lib/db", () => ({
  db: {
    order: {
      findMany: vi.fn(async ({ where }: { where: Row }) => mem.orders.filter((o) => match(o, where))),
      findUnique: vi.fn(async ({ where }: { where: Row }) => mem.orders.find((o) => match(o, where)) ?? null),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => Object.assign(mem.orders.find((o) => match(o, where))!, data)),
    },
    afterSale: {
      upsert: vi.fn(async ({ where, create, update }: { where: { type_ebayId: Row }; create: Row; update: Row }) => {
        const row = mem.sales.find((s) => match(s, where.type_ebayId));
        if (row) Object.assign(row, update);
        else mem.sales.push({ id: `S${++mem.seq}`, action: null, ...create });
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const rows = mem.sales.filter((s) => match(s, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      }),
      count: vi.fn(async ({ where }: { where: Row }) => mem.sales.filter((s) => match(s, where)).length),
      findFirst: vi.fn(async ({ where }: { where: Row }) => mem.sales.find((s) => match(s, where)) ?? null),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => Object.assign(mem.sales.find((s) => match(s, where))!, data)),
    },
    ebayAccount: { update: vi.fn() },
  },
}));
vi.mock("@/lib/crypto", () => ({ decrypt: (s: string) => s, encrypt: (s: string) => s }));

import { AfterSaleError, approveCancel, acceptReturn, cancelSupplier, syncAfterSales } from "./aftersale-service";

type Call = { method: string; url: string; auth?: string; body?: string };
let calls: Call[] = [];
let returns: unknown[] = [];
let cjDeleteOk = true;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

function router(url: string, init?: RequestInit): Response {
  const u = new URL(url);
  const p = u.pathname;
  if (p === "/post-order/v2/return/search") return json({ members: returns });
  if (p === "/post-order/v2/cancellation/search" && !(u.searchParams.get("creation_date_range_from") && u.searchParams.get("creation_date_range_to")))
    return json({ error: [{ errorId: 10003, message: "Validation Error - Missing input" }] }, 400); // comme eBay
  if (p === "/post-order/v2/cancellation/search")
    return json({ cancellations: [{ cancelId: "C1", legacyOrderId: "E-1", cancelState: "CANCEL_REQUESTED", cancelReason: "BUYER_ASKED_CANCEL", requestRefundAmount: { value: "30.75", currency: "USD" } }, { cancelId: "C2", legacyOrderId: "E-2", cancelState: "CANCEL_REQUESTED" }] });
  if (p.startsWith("/post-order/v2/cancellation/") && p.endsWith("/approve")) return new Response(null, { status: 204 });
  if (p.startsWith("/post-order/v2/return/") && p.endsWith("/decide")) return new Response(null, { status: 204 });
  if (u.hostname === "developers.cjdropshipping.com" && p.endsWith("/shopping/order/deleteOrder"))
    return cjDeleteOk ? json({ code: 200, result: true, message: "ok", data: true }) : json({ code: 1, result: false, message: "Order already paid", data: null });
  return json({ errors: [{ message: `route inconnue ${url} ${init?.method}` }] }, 500);
}

const account = { id: "ACC", accessToken: "USER", accessTokenExpires: new Date(Date.now() + 3600_000), refreshToken: "R", refreshTokenExpires: new Date(Date.now() + 86400_000) };
const user = () => ({ id: "U1", defaultMarketplace: "EBAY_US", ebayAccounts: [account], supplierAccounts: [{ supplier: "CJ", accessToken: "CJT" }] }) as never;

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://x");
  vi.stubEnv("SESSION_SECRET", "x".repeat(32));
  vi.stubEnv("ENCRYPTION_KEY", "0".repeat(64));
  mem.sales = []; mem.seq = 0; calls = []; cjDeleteOk = true;
  mem.orders = [
    { id: "O1", userId: "U1", ebayAccountId: "ACC", ebayOrderId: "E-1", status: "ORDERED", supplierOrderId: "CJ-9", marketplace: "EBAY_US", createdAt: new Date(), lines: [{ supplier: "CJ" }] },
    { id: "O2", userId: "U1", ebayAccountId: "ACC", ebayOrderId: "E-2", status: "PENDING", supplierOrderId: null, marketplace: "EBAY_US", createdAt: new Date(), lines: [] },
  ];
  returns = [{ returnId: "R1", orderId: "E-1", state: "RETURN_REQUESTED", creationInfo: { reason: "DEFECTIVE_ITEM", item: { itemTitle: "Can opener" } } }];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", url, auth: (init?.headers as Record<string, string> | undefined)?.Authorization, body: init?.body ? String(init.body) : undefined });
    return router(url, init);
  }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("retours et annulations", () => {
  it("relevé : dossiers enregistrés et liés à nos commandes ; commande pas encore passée = annulée chez nous", async () => {
    expect(await syncAfterSales(user())).toBe(3);
    expect(calls[0].auth).toBe("IAF USER");
    expect(mem.sales.find((s) => s.ebayId === "C1")).toMatchObject({ type: "CANCEL", orderId: "O1", open: true, amount: 30.75 });
    expect(mem.sales.find((s) => s.ebayId === "R1")).toMatchObject({ type: "RETURN", orderId: "O1", reason: "DEFECTIVE_ITEM" });
    expect(mem.orders.find((o) => o.id === "O2")).toMatchObject({ status: "CANCELLED", errorCode: "CANCELLED_BY_BUYER" });
    expect(mem.orders.find((o) => o.id === "O1")!.status).toBe("ORDERED"); // déjà commandée : c'est au vendeur de décider

    // Le retour est clos chez eBay : il n'est plus dans la recherche des retours ouverts.
    returns = [];
    await syncAfterSales(user());
    expect(mem.sales.find((s) => s.ebayId === "R1")!.open).toBe(false);
  });

  it("actions : accepter l'annulation, annuler chez CJ, accepter le retour ; refus si déjà fait", async () => {
    await syncAfterSales(user());
    const c1 = mem.sales.find((s) => s.ebayId === "C1")!;
    await cancelSupplier(user(), c1.id as string);
    expect(calls.some((c) => c.method === "DELETE" && c.url.includes("deleteOrder?orderId=CJ-9"))).toBe(true);
    expect(mem.orders.find((o) => o.id === "O1")!.status).toBe("CANCELLED");
    await approveCancel(user(), c1.id as string);
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/post-order/v2/cancellation/C1/approve"))).toBe(true);
    await expect(approveCancel(user(), c1.id as string)).rejects.toBeInstanceOf(AfterSaleError);

    const r1 = mem.sales.find((s) => s.ebayId === "R1")!;
    await acceptReturn(user(), r1.id as string);
    const decide = calls.find((c) => c.url.endsWith("/post-order/v2/return/R1/decide"))!;
    expect(JSON.parse(decide.body!)).toEqual({ decision: "ACCEPT" });
  });

  it("commande CJ déjà payée : annulation à faire depuis le compte CJ", async () => {
    cjDeleteOk = false;
    await syncAfterSales(user());
    const c1 = mem.sales.find((s) => s.ebayId === "C1")!;
    await expect(cancelSupplier(user(), c1.id as string)).rejects.toMatchObject({ code: "SUPPLIER_MANUAL" });
    expect(mem.orders.find((o) => o.id === "O1")!.status).toBe("ORDERED");
  });
});
