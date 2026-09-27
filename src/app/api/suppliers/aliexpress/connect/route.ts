import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "node:crypto";
import { currentUser } from "@/lib/auth";
import { authorizeUrl } from "@/lib/suppliers/aliexpress";
import { aeConfig, aeRedirectUri } from "@/lib/suppliers";

/** Envoie le client sur la page d'autorisation AliExpress (URL de retour à déclarer dans l'app AliExpress). */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  const cfg = aeConfig();
  if (!cfg) return NextResponse.redirect(new URL("/settings?ae=unavailable", req.url));
  const state = crypto.randomBytes(16).toString("hex");
  (await cookies()).set("ae_oauth_state", state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
  return NextResponse.redirect(authorizeUrl(cfg, aeRedirectUri(), state));
}
