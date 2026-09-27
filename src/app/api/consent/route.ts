import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { REF_COOKIE, REF_COOKIE_DAYS, sanitizeRefCode } from "@/lib/affiliate";

const body = z.object({ choice: z.enum(["all", "essential"]) });

/** Choix de cookies : « all » garde le lien d'affiliation 60 jours ; « essential » le laisse expirer à la fermeture du navigateur. */
export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const jar = await cookies();
  const secure = process.env.NODE_ENV === "production";
  jar.set("consent", parsed.data.choice, { sameSite: "lax", path: "/", maxAge: 365 * 86_400, secure });
  const ref = sanitizeRefCode(jar.get(REF_COOKIE)?.value);
  if (ref) {
    if (parsed.data.choice === "all") jar.set(REF_COOKIE, ref, { httpOnly: true, sameSite: "lax", path: "/", maxAge: REF_COOKIE_DAYS * 86_400, secure });
    else jar.set(REF_COOKIE, ref, { httpOnly: true, sameSite: "lax", path: "/", secure }); // cookie de session
  }
  return NextResponse.json({ ok: true });
}
