import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { startSession } from "@/lib/auth";
import { REF_COOKIE } from "@/lib/affiliate";
import { env } from "@/lib/env";
import { GOOGLE_COOKIE, googleProfile } from "@/lib/google-auth";
import { getI18n } from "@/lib/i18n/server";
import { signInWithGoogle } from "@/lib/signup";

export const dynamic = "force-dynamic";

/** Retour de Google : vérifie le state, lit l'email vérifié, connecte (ou crée) le compte. */
export async function GET(req: Request) {
  const app = env().APP_URL;
  const fail = (code: string) => {
    const res = NextResponse.redirect(new URL(`/login?error=${code}`, app));
    res.cookies.delete({ name: GOOGLE_COOKIE, path: "/api/auth/google" });
    return res;
  };
  const url = new URL(req.url);
  const jar = await cookies();
  let flow: { state?: string; verifier?: string } = {};
  try {
    flow = JSON.parse(jar.get(GOOGLE_COOKIE)?.value ?? "{}");
  } catch {
    /* cookie illisible */
  }
  const code = url.searchParams.get("code");
  // Annulé par l'utilisateur chez Google, ou lien rejoué / venu d'ailleurs (state différent) : on refuse.
  if (!code || !flow.state || !flow.verifier || url.searchParams.get("state") !== flow.state) return fail("GOOGLE_FAILED");

  try {
    const profile = await googleProfile(code, flow.verifier);
    const { locale } = await getI18n();
    const r = await signInWithGoogle(profile, { locale, refCookie: jar.get(REF_COOKIE)?.value });
    if (!r.ok) return fail(r.error);
    await startSession(r.userId);
    const res = NextResponse.redirect(new URL(r.created ? "/billing" : "/dashboard", app));
    res.cookies.delete({ name: GOOGLE_COOKIE, path: "/api/auth/google" });
    return res;
  } catch (e) {
    console.error("Google sign-in", e);
    return fail("GOOGLE_FAILED");
  }
}
