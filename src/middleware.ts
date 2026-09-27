import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

const PROTECTED = ["/dashboard", "/finder", "/settings", "/billing"];

export async function middleware(req: NextRequest) {
  if (!PROTECTED.some((p) => req.nextUrl.pathname.startsWith(p))) return NextResponse.next();
  const userId = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!userId) return NextResponse.redirect(new URL("/login", req.url));
  return NextResponse.next();
}

export const config = { matcher: ["/dashboard/:path*", "/finder/:path*", "/settings/:path*", "/billing/:path*"] };
