import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

const PROTECTED = ["/dashboard", "/finder", "/settings", "/billing", "/affiliate", "/admin", "/review", "/listings"];
const REF_COOKIE = "ref";
const REF_COOKIE_DAYS = 60;

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  if (PROTECTED.some((p) => path === p || path.startsWith(p + "/"))) {
    const userId = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
    if (!userId) return NextResponse.redirect(new URL("/login", req.url));
  }

  const res = NextResponse.next();
  // Lien d'affiliation : ?ref=CODE → cookie 60 jours (le premier affilié garde le client).
  const ref = req.nextUrl.searchParams.get("ref")?.trim().toLowerCase();
  if (ref && /^[a-z0-9]{4,32}$/.test(ref) && !req.cookies.get(REF_COOKIE)) {
    res.cookies.set(REF_COOKIE, ref, { httpOnly: true, sameSite: "lax", path: "/", maxAge: REF_COOKIE_DAYS * 86_400 });
  }
  return res;
}

// Toutes les pages, sauf l'API, les fichiers Next.js et les fichiers statiques.
export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"] };
