/**
 * Parcours de connexion de bout en bout (routes API réelles, base de données et emails simulés) :
 * inscription, mot de passe oublié, réinitialisation, blocage après trop d'essais.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const mem = vi.hoisted(() => ({ users: [] as Row[], tokens: [] as Row[], jar: new Map<string, string>(), seq: 0 }));

function match(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, c]) => {
    const v = row[k];
    if (c && typeof c === "object" && !(c instanceof Date)) {
      const o = c as Row;
      if ("gte" in o) return v instanceof Date && v >= (o.gte as Date);
    }
    return v === c;
  });
}

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(async ({ where }: { where: Row }) => mem.users.find((u) => match(u, where)) ?? null),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const u = { id: `U${++mem.seq}`, failedLogins: 0, lockedUntil: null, passwordChangedAt: null, locale: "en", ...data };
        mem.users.push(u);
        return u;
      }),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => Object.assign(mem.users.find((u) => match(u, where))!, data)),
    },
    passwordResetToken: {
      count: vi.fn(async ({ where }: { where: Row }) => mem.tokens.filter((t) => match(t, where)).length),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const t = { id: `T${++mem.seq}`, usedAt: null, createdAt: new Date(), ...data };
        mem.tokens.push(t);
        return t;
      }),
      findUnique: vi.fn(async ({ where }: { where: Row }) => mem.tokens.find((t) => match(t, where)) ?? null),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const rows = mem.tokens.filter((t) => match(t, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      }),
      deleteMany: vi.fn(async ({ where }: { where: Row }) => {
        const before = mem.tokens.length;
        mem.tokens = mem.tokens.filter((t) => !match(t, where));
        return { count: before - mem.tokens.length };
      }),
    },
  },
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (mem.jar.has(name) ? { name, value: mem.jar.get(name)! } : undefined),
    set: (name: string, value: string) => void mem.jar.set(name, value),
    delete: (name: string) => void mem.jar.delete(name),
  }),
  headers: async () => new Headers({ "accept-language": "fr-FR,fr;q=0.9" }),
}));

import { POST as register } from "@/app/api/auth/register/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as forgot } from "@/app/api/auth/forgot/route";
import { POST as reset } from "@/app/api/auth/reset/route";
import { hashToken } from "./password-reset";
import { checkPassword } from "./auth";

const req = (body: unknown) => new Request("http://x/api", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const call = async (h: (r: Request) => Promise<Response>, body: unknown) => {
  const res = await h(req(body));
  return { status: res.status, body: (await res.json()) as Row };
};

let emails: { to: string; subject: string; text: string }[] = [];

beforeEach(() => {
  mem.users = [];
  mem.tokens = [];
  mem.jar = new Map();
  emails = [];
  vi.stubEnv("SESSION_SECRET", "s".repeat(40));
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("APP_URL", "https://app.example.com");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).startsWith("https://api.resend.com/")) emails.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ id: "e1" }), { status: 200 });
  }));
});

describe("inscription", { timeout: 30_000 }, () => {
  it("conditions obligatoires ; puis compte créé, session ouverte, email de bienvenue dans la langue du navigateur", async () => {
    expect(await call(register, { email: "a@b.com", password: "password123" })).toEqual({ status: 400, body: { error: "TERMS_REQUIRED" } });
    const r = await call(register, { email: "A@B.com", password: "password123", acceptTerms: true });
    expect(r.status).toBe(200);
    expect(mem.users[0]).toMatchObject({ email: "a@b.com", locale: "fr" });
    expect(mem.users[0].termsAcceptedAt).toBeInstanceOf(Date);
    expect(mem.jar.get("session")).toBeTruthy();
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ to: "a@b.com" });
    expect(emails[0].subject).toContain("Bienvenue");
    expect(await call(register, { email: "a@b.com", password: "password123", acceptTerms: true })).toEqual({ status: 409, body: { error: "EMAIL_TAKEN" } });
  });
});

describe("mot de passe oublié", { timeout: 30_000 }, () => {
  it("même réponse si le compte n'existe pas, sans email", async () => {
    expect(await call(forgot, { email: "nobody@x.com" })).toEqual({ status: 200, body: { ok: true } });
    expect(emails).toHaveLength(0);
  });

  it("lien par email (seule l'empreinte est stockée) → nouveau mot de passe → lien inutilisable ensuite", async () => {
    await call(register, { email: "a@b.com", password: "oldpassword", acceptTerms: true });
    emails = [];
    await call(forgot, { email: "a@b.com" });
    expect(emails).toHaveLength(1);
    const raw = decodeURIComponent(emails[0].text.match(/token=([^\s]+)/)![1]);
    expect(emails[0].text).toContain("https://app.example.com/reset-password?token=");
    expect(mem.tokens[0].tokenHash).toBe(hashToken(raw));
    expect(JSON.stringify(mem.tokens)).not.toContain(raw);

    expect(await call(reset, { token: raw, password: "short" })).toEqual({ status: 400, body: { error: "INVALID_INPUT" } });
    expect(await call(reset, { token: raw, password: "newpassword1" })).toEqual({ status: 200, body: { ok: true } });
    const u = mem.users[0];
    expect(await checkPassword("newpassword1", u.passwordHash as string)).toBe(true);
    expect(u.passwordChangedAt).toBeInstanceOf(Date);
    expect(await call(reset, { token: raw, password: "another123" })).toEqual({ status: 400, body: { error: "RESET_INVALID" } });
  });

  it("lien expiré refusé ; 3 demandes par heure au maximum", async () => {
    await call(register, { email: "a@b.com", password: "oldpassword", acceptTerms: true });
    emails = [];
    for (let i = 0; i < 5; i++) await call(forgot, { email: "a@b.com" });
    expect(emails).toHaveLength(3);
    mem.tokens[0].expiresAt = new Date(Date.now() - 1);
    const raw = decodeURIComponent(emails[0].text.match(/token=([^\s]+)/)![1]);
    expect(await call(reset, { token: raw, password: "newpassword1" })).toEqual({ status: 400, body: { error: "RESET_INVALID" } });
  });
});

describe("connexion", { timeout: 60_000 }, () => {
  it("bloquée 15 min au 8e mauvais mot de passe, même avec le bon ensuite", async () => {
    await call(register, { email: "a@b.com", password: "rightpassword", acceptTerms: true });
    for (let i = 0; i < 7; i++) expect((await call(login, { email: "a@b.com", password: "wrong" })).body.error).toBe("BAD_CREDENTIALS");
    expect(await call(login, { email: "a@b.com", password: "wrong" })).toEqual({ status: 429, body: { error: "TOO_MANY_ATTEMPTS" } });
    expect(await call(login, { email: "a@b.com", password: "rightpassword" })).toEqual({ status: 429, body: { error: "TOO_MANY_ATTEMPTS" } });
    mem.users[0].lockedUntil = new Date(Date.now() - 1);
    expect(await call(login, { email: "a@b.com", password: "rightpassword" })).toEqual({ status: 200, body: { ok: true } });
    expect(mem.users[0]).toMatchObject({ failedLogins: 0, lockedUntil: null });
  });

  it("email inconnu : même erreur qu'un mauvais mot de passe", async () => {
    expect(await call(login, { email: "nobody@x.com", password: "whatever" })).toEqual({ status: 401, body: { error: "BAD_CREDENTIALS" } });
  });
});
