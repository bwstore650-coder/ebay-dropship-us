import { NextResponse } from "next/server";
import { syncAllMessages } from "@/lib/buyer-messages";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Tâche planifiée (toutes les 30 minutes) : questions des acheteurs + réponses préparées par l'IA. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  return NextResponse.json(await syncAllMessages(Date.now() + 240_000));
}
