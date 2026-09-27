import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { checkPassword, startSession } from "@/lib/auth";

const body = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  const user = await db.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (!user || !(await checkPassword(parsed.data.password, user.passwordHash)))
    return NextResponse.json({ error: "Email ou mot de passe incorrect" }, { status: 401 });
  await startSession(user.id);
  return NextResponse.json({ ok: true });
}
