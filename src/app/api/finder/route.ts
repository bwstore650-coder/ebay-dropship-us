import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { decrypt } from "@/lib/crypto";
import { findProduct } from "@/lib/finder";

const body = z.object({
  keyword: z.string().min(2).max(120),
  marketId: z.enum(["EBAY_US", "EBAY_CA", "EBAY_GB", "EBAY_AU"]).optional(),
});

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  if (user.plan === "NONE") return NextResponse.json({ error: "Choisis une formule pour utiliser le chercheur" }, { status: 402 });
  const parsed = body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Mot-clé invalide" }, { status: 400 });

  const cjAccount = user.supplierAccounts.find((a: { supplier: string }) => a.supplier === "CJ");
  try {
    const result = await findProduct(parsed.data.keyword, {
      cjToken: cjAccount ? decrypt(cjAccount.accessToken) : undefined,
      minMarginPct: user.minMarginPct,
      marketId: parsed.data.marketId ?? (user.defaultMarketplace as "EBAY_US" | "EBAY_CA" | "EBAY_GB" | "EBAY_AU"),
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
