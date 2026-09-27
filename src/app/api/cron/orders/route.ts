import { NextResponse } from "next/server";
import { runAll } from "@/lib/order-service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Tâche planifiée (toutes les 15 minutes, voir vercel.json) : nouvelles ventes, commandes chez CJ, suivis.
 * Protégée par CRON_SECRET (Vercel envoie « Authorization: Bearer <CRON_SECRET> »).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const result = await runAll(Date.now() + 240_000);
  const sum = (k: "imported" | "ordered" | "review" | "shipped") => result.reports.reduce((s, r) => s + r[k], 0);
  return NextResponse.json({
    users: result.users,
    processed: result.reports.length,
    imported: sum("imported"),
    ordered: sum("ordered"),
    review: sum("review"),
    shipped: sum("shipped"),
  });
}
