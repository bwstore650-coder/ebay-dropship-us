import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

const PROTECTED = ["/dashboard", "/finder", "/settings", "/billing", "/affiliate", "/admin", "/review", "/listings", "/orders"];
const REF_COOKIE = "ref";
const REF_COOKIE_DAYS = 60;
const CONSENT_COOKIE = "consent";

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  if (PROTECTED.some((p) => path === p || path.startsWith(p + "/"))) {
    // Filtre rapide : sans cookie de session, direction /login. La vérification complète (signature, compte,
    // mot de passe changé, droits admin) est faite côté serveur par requireUser / requireAdmin sur chaque page.
    if (!req.cookies.get(SESSION_COOKIE)?.value) return NextResponse.redirect(new URL("/login", req.url));
  }

  const res = NextResponse.next();
  // Lien d'affiliation : ?ref=CODE (le premier affilié garde le client).
  // Sans accord aux cookies : cookie de session (effacé à la fermeture du navigateur) ; avec accord : 60 jours.
  const ref = req.nextUrl.searchParams.get("ref")?.trim().toLowerCase();
  if (ref && /^[a-z0-9]{4,32}$/.test(ref) && !req.cookies.get(REF_COOKIE)) {
    const consented = req.cookies.get(CONSENT_COOKIE)?.value === "all";
    res.cookies.set(REF_COOKIE, ref, { httpOnly: true, sameSite: "lax", path: "/", ...(consented ? { maxAge: REF_COOKIE_DAYS * 86_400 } : {}) });
  }
  return res;
}

// Toutes les pages, sauf l'API, les fichiers Next.js et les fichiers statiques.
export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"] };
