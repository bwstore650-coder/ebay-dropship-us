import { NextResponse } from "next/server";
import { advanceAll } from "@/lib/sniper-service";
import { autopilotAll } from "@/lib/autopilot";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Tâche planifiée (toutes les 5 minutes, voir vercel.json) : continue les recherches Sniper quand la page est fermée. Protégée par CRON_SECRET. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  // Pilote automatique : recherches du jour lancées d'abord, puis avancées avec les autres.
  const autopilot = await autopilotAll().catch((e) => {
    console.error("Pilote automatique", e);
    return 0;
  });
  const advanced = await advanceAll(Date.now() + 240_000);
  return NextResponse.json({ autopilot, advanced });
}
