import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword, startSession } from "@/lib/auth";

const body = z.object({ email: z.string().email(), password: z.string().min(8) });

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Email ou mot de passe invalide (8 caractères min.)" }, { status: 400 });
  const email = parsed.data.email.toLowerCase();
  if (await db.user.findUnique({ where: { email } }))
    return NextResponse.json({ error: "Un compte existe déjà avec cet email" }, { status: 409 });
  const user = await db.user.create({ data: { email, passwordHash: await hashPassword(parsed.data.password) } });
  await startSession(user.id);
  return NextResponse.json({ ok: true });
}
