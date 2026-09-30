import { NextResponse } from "next/server";
import { refreshTrends, trendMarkets } from "@/lib/research-service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Tâche planifiée (une fois par jour, voir vercel.json) : meilleures ventes par niche et par pays. Protégée par CRON_SECRET. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const deadline = Date.now() + 270_000;
  const result: Record<string, number> = {};
  for (const m of await trendMarkets()) {
    if (Date.now() > deadline) break;
    result[m] = await refreshTrends(m, deadline);
  }
  return NextResponse.json(result);
}
