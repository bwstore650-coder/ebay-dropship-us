import { NextResponse } from "next/server";
import { GOOGLE_COOKIE, GOOGLE_COOKIE_MAX_AGE, googleAuthorizeUrl, googleEnabled, newGoogleFlow } from "@/lib/google-auth";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Bouton « Continuer avec Google » : envoie vers la page de connexion Google. */
export async function GET() {
  const app = env().APP_URL;
  if (!googleEnabled()) return NextResponse.redirect(new URL("/login?error=GOOGLE_FAILED", app));
  const f = newGoogleFlow();
  const res = NextResponse.redirect(googleAuthorizeUrl(f.state, f.challenge));
  res.cookies.set(GOOGLE_COOKIE, JSON.stringify({ state: f.state, verifier: f.verifier }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // le retour de Google est une navigation normale : le cookie est bien envoyé
    path: "/api/auth/google",
    maxAge: GOOGLE_COOKIE_MAX_AGE,
  });
  return res;
}
