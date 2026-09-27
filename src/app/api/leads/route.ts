import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/db";

const body = z.object({
  email: z.string().email().max(200),
  source: z.string().min(1).max(50),
});

/** Enregistre un email venant d'un outil gratuit (sans doublon). */
export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Please enter a valid email." }, { status: 400 });
  const refCode = (await cookies()).get("ref")?.value ?? null;
  await db.lead.upsert({
    where: { email: parsed.data.email.toLowerCase() },
    create: { email: parsed.data.email.toLowerCase(), source: parsed.data.source, refCode },
    update: {},
  });
  return NextResponse.json({ ok: true });
}
