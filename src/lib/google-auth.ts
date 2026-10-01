/**
 * Connexion avec Google (OAuth 2.0, « authorization code » + PKCE).
 * Sellvela ne voit jamais le mot de passe Google : seulement l'email vérifié et l'identifiant Google.
 */
import { createHash, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

/** Cookie temporaire (10 min) qui relie l'aller vers Google et le retour. */
export const GOOGLE_COOKIE = "g_oauth";
export const GOOGLE_COOKIE_MAX_AGE = 600;

export const googleEnabled = () => Boolean(env().GOOGLE_CLIENT_ID && env().GOOGLE_CLIENT_SECRET);
export const googleRedirectUri = () => `${env().APP_URL.replace(/\/+$/, "")}/api/auth/google/callback`;

const b64url = (b: Buffer) => b.toString("base64url");

/** state (anti-CSRF) + code_verifier (PKCE), aléatoires. */
export function newGoogleFlow() {
  const verifier = b64url(randomBytes(32));
  return { state: b64url(randomBytes(24)), verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
}

export function googleAuthorizeUrl(state: string, challenge: string): string {
  const q = new URLSearchParams({
    client_id: env().GOOGLE_CLIENT_ID,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: "openid email",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `${AUTH_URL}?${q}`;
}

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
}

/** Échange le code contre un jeton, puis lit l'email du compte Google (directement chez Google, en HTTPS). */
export async function googleProfile(code: string, verifier: string): Promise<GoogleProfile> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      code_verifier: verifier,
      client_id: env().GOOGLE_CLIENT_ID,
      client_secret: env().GOOGLE_CLIENT_SECRET,
      redirect_uri: googleRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Google token ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const { access_token } = (await res.json()) as { access_token?: string };
  if (!access_token) throw new Error("Google token: no access_token");
  const info = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${access_token}` } });
  if (!info.ok) throw new Error(`Google userinfo ${info.status}`);
  const u = (await info.json()) as { sub?: string; email?: string; email_verified?: boolean | string };
  if (!u.sub || !u.email) throw new Error("Google userinfo: missing sub/email");
  return { sub: u.sub, email: u.email.toLowerCase(), emailVerified: u.email_verified === true || u.email_verified === "true" };
}
