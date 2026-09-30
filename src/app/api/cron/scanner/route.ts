import { NextResponse } from "next/server";
import { scanTick } from "@/lib/product-pool";
import { trendMarkets } from "@/lib/research-service";
import { HIGH_TICKET_SEEDS } from "@/lib/sniper";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Tâche planifiée (toutes les heures, voir vercel.json) : analyse à l'avance le catalogue fournisseur
 * pour que le Sniper propose des produits tout de suite. Les États-Unis d'abord, puis les autres pays des clients.
 * Protégée par CRON_SECRET.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const end = Date.now() + 280_000;
  const markets = await trendMarkets();
  const result: Record<string, unknown> = {};
  for (const [i, m] of markets.entries()) {
    const left = end - Date.now();
    if (left < 30_000) break;
    // Les États-Unis ont la plus grande part du temps ; les autres pays se partagent le reste.
    const share = i === 0 ? (markets.length === 1 ? left : left * 0.6) : left / (markets.length - i);
    // Un tiers du temps pour les produits chers (« High ticket »), le reste pour le catalogue courant.
    const until = Date.now() + share;
    const ht = await scanTick(m, Date.now() + share / 3, { seeds: HIGH_TICKET_SEEDS, cursorKey: `${m}:HT`, refresh: false });
    const main = await scanTick(m, until);
    result[m] = { ...main, highTicket: ht.analyzed };
  }
  return NextResponse.json(result);
}
