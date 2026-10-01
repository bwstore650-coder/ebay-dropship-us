import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

type U = { id: string; email: string; googleId: string | null; passwordHash: string | null; referralCode: string; referredById: string | null; passwordChangedAt?: Date | null };
const mem = vi.hoisted(() => ({ users: [] as U[], emails: [] as string[] }));

function find(where: Partial<U>) {
  const [k, v] = Object.entries(where)[0];
  return mem.users.find((u) => (u as Record<string, unknown>)[k] === v) ?? null;
}
vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(async ({ where }: { where: Partial<U> }) => find(where)),
      findFirst: vi.fn(async ({ where }: { where: Partial<U> }) => find(where)),
      create: vi.fn(async ({ data }: { data: Omit<U, "id"> }) => {
        const u = { id: `u${mem.users.length + 1}`, ...data } as U;
        mem.users.push(u);
        return u;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<U> }) => Object.assign(mem.users.find((u) => u.id === where.id)!, data)),
    },
  },
}));
vi.mock("@/lib/email", () => ({
  welcomeEmail: (to: string) => ({ to }),
  sendEmail: vi.fn(async (m: { to: string }) => void mem.emails.push(m.to)),
}));

import { signInWithGoogle } from "./signup";
import { googleAuthorizeUrl, googleProfile, googleRedirectUri, newGoogleFlow } from "./google-auth";

const ctx = { locale: "en" as const };
const g = (over: Partial<{ sub: string; email: string; emailVerified: boolean }> = {}) => ({ sub: "G1", email: "ann@gmail.com", emailVerified: true, ...over });

beforeEach(() => {
  mem.users = []; mem.emails = [];
  vi.stubEnv("APP_URL", "https://sellvela.vercel.app");
  vi.stubEnv("GOOGLE_CLIENT_ID", "cid.apps.googleusercontent.com");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
  vi.stubEnv("DATABASE_URL", "postgresql://x");
  vi.stubEnv("SESSION_SECRET", "x".repeat(32));
  vi.stubEnv("ENCRYPTION_KEY", "0".repeat(64));
});

describe("connexion avec Google", () => {
  it("nouveau compte : créé sans mot de passe, conditions acceptées, email de bienvenue ; ensuite reconnu par son identifiant Google", async () => {
    const r = await signInWithGoogle(g(), ctx);
    expect(r).toEqual({ ok: true, userId: "u1", created: true });
    expect(mem.users[0]).toMatchObject({ email: "ann@gmail.com", googleId: "G1", passwordHash: null, termsAcceptedAt: expect.any(Date) });
    expect(mem.emails).toEqual(["ann@gmail.com"]);
    // L'utilisateur change d'adresse chez Google : toujours le même compte.
    expect(await signInWithGoogle(g({ email: "ann.new@gmail.com" }), ctx)).toEqual({ ok: true, userId: "u1", created: false });
    expect(mem.users).toHaveLength(1);
  });

  it("compte existant avec le même email : lié, ancien mot de passe retiré et autres sessions fermées", async () => {
    mem.users.push({ id: "u9", email: "ann@gmail.com", googleId: null, passwordHash: "$2b$hash", referralCode: "R", referredById: null });
    const r = await signInWithGoogle(g(), ctx);
    expect(r).toEqual({ ok: true, userId: "u9", created: false });
    expect(mem.users[0]).toMatchObject({ googleId: "G1", passwordHash: null, passwordChangedAt: expect.any(Date) });
    expect(mem.emails).toEqual([]);
  });

  it("refusé : email non vérifié par Google, ou email déjà lié à un autre compte Google", async () => {
    expect(await signInWithGoogle(g({ emailVerified: false }), ctx)).toEqual({ ok: false, error: "GOOGLE_UNVERIFIED" });
    mem.users.push({ id: "u9", email: "ann@gmail.com", googleId: "OTHER", passwordHash: null, referralCode: "R", referredById: null });
    expect(await signInWithGoogle(g(), ctx)).toEqual({ ok: false, error: "GOOGLE_CONFLICT" });
    expect(mem.users[0].googleId).toBe("OTHER");
  });

  it("lien vers Google : PKCE S256, state, adresse de retour exacte, seulement l'email", () => {
    const f = newGoogleFlow();
    expect(f.challenge).toBe(createHash("sha256").update(f.verifier).digest("base64url"));
    expect(newGoogleFlow().state).not.toBe(f.state);
    const u = new URL(googleAuthorizeUrl(f.state, f.challenge));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      client_id: "cid.apps.googleusercontent.com", redirect_uri: "https://sellvela.vercel.app/api/auth/google/callback",
      response_type: "code", scope: "openid email", state: f.state, code_challenge: f.challenge, code_challenge_method: "S256",
    });
    expect(googleRedirectUri()).toBe("https://sellvela.vercel.app/api/auth/google/callback");
  });

  it("retour de Google : échange du code avec le verifier, email en minuscules", async () => {
    const calls: { url: string; body?: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body?.toString() });
      if (url.includes("/token")) return new Response(JSON.stringify({ access_token: "AT" }));
      return new Response(JSON.stringify({ sub: "G1", email: "Ann@Gmail.com", email_verified: true }));
    }));
    expect(await googleProfile("CODE", "VER")).toEqual({ sub: "G1", email: "ann@gmail.com", emailVerified: true });
    const body = new URLSearchParams(calls[0].body);
    expect(Object.fromEntries(body)).toMatchObject({ code: "CODE", code_verifier: "VER", grant_type: "authorization_code", redirect_uri: "https://sellvela.vercel.app/api/auth/google/callback" });
    vi.unstubAllGlobals();
  });
});
