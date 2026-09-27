import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { createToken } from "@/lib/suppliers/aliexpress";
import { aeConfig } from "@/lib/suppliers";

/** Retour d'AliExpress après autorisation : on enregistre les jetons (chiffrés). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  const jar = await cookies();
  const expected = jar.get("ae_oauth_state")?.value;
  jar.delete("ae_oauth_state");
  const code = url.searchParams.get("code");
  const cfg = aeConfig();
  if (!cfg || !code || !expected || url.searchParams.get("state") !== expected) return NextResponse.redirect(new URL("/settings?ae=error", req.url));
  try {
    const t = await createToken(cfg, code);
    const data = {
      accessToken: encrypt(t.access_token),
      refreshToken: encrypt(t.refresh_token),
      expiresAt: new Date(t.expire_time),
    };
    await db.supplierAccount.upsert({
      where: { userId_supplier: { userId: user.id, supplier: "ALIEXPRESS" } },
      create: { userId: user.id, supplier: "ALIEXPRESS", ...data },
      update: data,
    });
  } catch (e) {
    console.error("AliExpress OAuth", e);
    return NextResponse.redirect(new URL("/settings?ae=error", req.url));
  }
  return NextResponse.redirect(new URL("/settings?ae=connected", req.url));
}
