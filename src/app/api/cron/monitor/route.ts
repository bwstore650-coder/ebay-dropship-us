import { NextResponse } from "next/server";
import { monitorAll } from "@/lib/monitor-service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Tâche planifiée (toutes les heures, voir vercel.json) : stock et prix des annonces. Protégée par CRON_SECRET. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const r = await monitorAll(Date.now() + 240_000);
  const sum = (k: "checked" | "paused" | "resumed" | "updated" | "errors") => r.reports.reduce((s, x) => s + x[k], 0);
  return NextResponse.json({ users: r.users, checked: sum("checked"), paused: sum("paused"), resumed: sum("resumed"), updated: sum("updated"), errors: sum("errors") });
}
