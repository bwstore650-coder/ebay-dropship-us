import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { getAccessToken } from "@/lib/suppliers/cj";

const body = z.object({ apiKey: z.string().min(10) });

/** Connecte le compte CJ du client avec sa clé API (CJ > Apps > API). */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_KEY" }, { status: 400 });
  try {
    const t = await getAccessToken(parsed.data.apiKey);
    const data = {
      accessToken: encrypt(t.accessToken),
      refreshToken: encrypt(t.refreshToken),
      expiresAt: new Date(t.accessTokenExpiryDate),
    };
    await db.supplierAccount.upsert({
      where: { userId_supplier: { userId: user.id, supplier: "CJ" } },
      create: { userId: user.id, supplier: "CJ", ...data },
      update: data,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("CJ connect", e);
    return NextResponse.json({ error: "INVALID_KEY" }, { status: 400 });
  }
}
