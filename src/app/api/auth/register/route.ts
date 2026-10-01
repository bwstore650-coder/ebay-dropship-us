import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword, startSession } from "@/lib/auth";
import { REF_COOKIE } from "@/lib/affiliate";
import { getI18n } from "@/lib/i18n/server";
import { createAccount } from "@/lib/signup";

const body = z.object({ email: z.string().email().max(200), password: z.string().min(8).max(200), acceptTerms: z.literal(true) });

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = body.safeParse(json);
  if (!parsed.success) {
    const termsMissing = json && typeof json === "object" && (json as { acceptTerms?: unknown }).acceptTerms !== true;
    return NextResponse.json({ error: termsMissing ? "TERMS_REQUIRED" : "INVALID_INPUT" }, { status: 400 });
  }
  const { locale } = await getI18n();
  const email = parsed.data.email.toLowerCase();
  if (await db.user.findUnique({ where: { email } }))
    return NextResponse.json({ error: "EMAIL_TAKEN" }, { status: 409 });

  const user = await createAccount(
    { email, passwordHash: await hashPassword(parsed.data.password) },
    { locale, refCookie: (await cookies()).get(REF_COOKIE)?.value },
  );
  await startSession(user.id);
  return NextResponse.json({ ok: true });
}
