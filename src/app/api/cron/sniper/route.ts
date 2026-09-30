import { NextResponse } from "next/server";
import { advanceAll } from "@/lib/sniper-service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Tâche planifiée (toutes les 5 minutes, voir vercel.json) : continue les recherches Sniper quand la page est fermée. Protégée par CRON_SECRET. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const advanced = await advanceAll(Date.now() + 240_000);
  return NextResponse.json({ advanced });
}
