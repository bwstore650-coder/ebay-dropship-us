import { NextResponse } from "next/server";
import { monitorAll } from "@/lib/monitor-service";
import { syncAllExternal } from "@/lib/external-listings";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Tâche planifiée (toutes les heures, voir vercel.json) : stock et prix des annonces. Protégée par CRON_SECRET. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  // Annonces créées directement sur eBay (toutes les 6 h par vendeur) : fin de gestion si elles ne sont plus en ligne.
  const synced = await syncAllExternal(Date.now() + 60_000).catch((e) => { console.error("Annonces externes", e); return 0; });
  const r = await monitorAll(Date.now() + 240_000);
  const sum = (k: "checked" | "paused" | "resumed" | "updated" | "repriced" | "errors") => r.reports.reduce((s, x) => s + x[k], 0);
  return NextResponse.json({ synced, users: r.users, checked: sum("checked"), paused: sum("paused"), resumed: sum("resumed"), updated: sum("updated"), repriced: sum("repriced"), errors: sum("errors") });
}
