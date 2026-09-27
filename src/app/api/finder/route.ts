import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { decrypt } from "@/lib/crypto";
import { findProduct } from "@/lib/finder";
import { isMarketplaceId, marketplace } from "@/lib/marketplaces";

const body = z.object({
  keyword: z.string().min(2).max(120),
  marketId: z.string().refine(isMarketplaceId).optional(),
});

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (user.plan === "NONE") return NextResponse.json({ error: "PLAN_REQUIRED" }, { status: 402 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });

  const cjAccount = user.supplierAccounts.find((a: { supplier: string }) => a.supplier === "CJ");
  try {
    const result = await findProduct(parsed.data.keyword, {
      cjToken: cjAccount ? decrypt(cjAccount.accessToken) : undefined,
      minMarginPct: user.minMarginPct,
      marketId: marketplace(parsed.data.marketId ?? user.defaultMarketplace).id,
    });
    return NextResponse.json(result);
  } catch (e) {
    console.error("Finder", e);
    return NextResponse.json({ error: "UPSTREAM" }, { status: 502 });
  }
}
