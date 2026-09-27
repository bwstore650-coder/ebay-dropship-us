import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "node:crypto";
import { currentUser } from "@/lib/auth";
import { authorizeUrl } from "@/lib/ebay";

/** Envoie le client sur la page de consentement eBay. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  const state = crypto.randomBytes(16).toString("hex");
  (await cookies()).set("ebay_oauth_state", state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
  return NextResponse.redirect(authorizeUrl(state));
}
