import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ emails: [] as { subject: string; text: string }[], subs: [] as { id: string; endpoint: string; p256dh: string; auth: string }[], sent: [] as string[], deleted: [] as string[] }));
vi.mock("@/lib/db", () => ({
  db: { pushSubscription: { findMany: vi.fn(async () => mocks.subs), delete: vi.fn(async ({ where }: { where: { id: string } }) => { mocks.deleted.push(where.id); }) } },
}));
vi.mock("@/lib/email", async (orig) => ({ ...(await orig<typeof import("./email")>()), sendEmail: vi.fn(async (e: { subject: string; text: string }) => { mocks.emails.push(e); return true; }) }));
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(async (s: { endpoint: string }) => {
      if (s.endpoint.includes("gone")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      mocks.sent.push(s.endpoint);
    }),
  },
}));

import { notifyNewSales, pushToUser } from "./notify";

const user = { id: "U1", email: "a@b.c", locale: "fr", notifySales: true, autoOrder: true };

beforeEach(() => {
  Object.assign(mocks, { emails: [], subs: [], sent: [], deleted: [] });
  vi.unstubAllEnvs();
});

describe("alertes de vente", () => {
  it("email pour le lot de ventes, dans la langue du vendeur ; pas d'email si désactivé", async () => {
    await notifyNewSales(user, [{ title: "Can opener", total: 19.99, currency: "USD" }, { title: "LED strip", total: 12.5, currency: "USD" }]);
    expect(mocks.emails).toHaveLength(1);
    expect(mocks.emails[0].subject).toMatch(/^2 nouvelles ventes : 32,49\s\$US$/);
    expect(mocks.emails[0].text).toContain("Sellvela passe la commande chez le fournisseur automatiquement.");
    await notifyNewSales({ ...user, notifySales: false }, [{ title: "x", total: 1, currency: "USD" }]);
    await notifyNewSales(user, []);
    expect(mocks.emails).toHaveLength(1);
  });

  it("notifications : rien sans clés VAPID ; abonnement expiré supprimé", async () => {
    mocks.subs = [{ id: "S1", endpoint: "https://push/ok", p256dh: "k".repeat(20), auth: "a".repeat(10) }, { id: "S2", endpoint: "https://push/gone", p256dh: "k".repeat(20), auth: "a".repeat(10) }];
    expect(await pushToUser("U1", { title: "t", body: "b", url: "/orders" })).toBe(0);
    vi.stubEnv("VAPID_PUBLIC_KEY", "pub");
    vi.stubEnv("VAPID_PRIVATE_KEY", "priv");
    expect(await pushToUser("U1", { title: "t", body: "b", url: "/orders" })).toBe(1);
    expect(mocks.sent).toEqual(["https://push/ok"]);
    expect(mocks.deleted).toEqual(["S2"]);
  });
});
