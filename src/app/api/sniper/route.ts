import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { isMarketplaceId, type MarketplaceId } from "@/lib/marketplaces";
import { MAX_KEYWORDS, MAX_TARGET, parseKeywords } from "@/lib/sniper";
import { createRun, SnipeError } from "@/lib/sniper-service";

const body = z.object({
  mode: z.enum(["CATALOG", "KEYWORDS"]),
  marketId: z.string().refine(isMarketplaceId),
  target: z.number().int().min(1).max(MAX_TARGET),
  minMarginPct: z.number().min(0).max(90).optional(),
  priceMin: z.number().min(0).max(100000).nullable().optional(),
  priceMax: z.number().min(0).max(100000).nullable().optional(),
  seeds: z.string().max(10000).default(""), // un mot-clé par ligne
  autoList: z.boolean().default(false),
  ebayAccountId: z.string().max(64).nullable().optional(),
});

/** Lance une recherche Sniper. Elle avance ensuite par étapes (/api/sniper/[id]/step). */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const d = parsed.data;
  const seeds = parseKeywords(d.seeds).slice(0, MAX_KEYWORDS);
  try {
    const run = await createRun(user, { ...d, marketId: d.marketId as MarketplaceId, seeds });
    return NextResponse.json({ id: run.id });
  } catch (e) {
    if (e instanceof SnipeError) return NextResponse.json({ error: e.code }, { status: e.code === "PLAN_REQUIRED" ? 402 : 400 });
    console.error("Sniper", e);
    return NextResponse.json({ error: "UPSTREAM" }, { status: 502 });
  }
}
