import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { isQuotaError } from "@/lib/ebay";
import { decrypt } from "@/lib/crypto";
import { findProduct } from "@/lib/finder";
import { isMarketplaceId, marketplace } from "@/lib/marketplaces";
import { offersFor, parseProductId } from "@/lib/suppliers/aliexpress";
import { openSession, SupplierError } from "@/lib/suppliers";

const body = z.object({
  keyword: z.string().min(2).max(120),
  marketId: z.string().refine(isMarketplaceId).optional(),
  aeProduct: z.string().max(500).optional(), // lien ou numéro d'un produit AliExpress à comparer
});

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (user.plan === "NONE") return NextResponse.json({ error: "PLAN_REQUIRED" }, { status: 402 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const m = marketplace(parsed.data.marketId ?? user.defaultMarketplace);

  // Produit AliExpress collé par le vendeur : ses variantes expédiées depuis un entrepôt du pays sont comparées aussi.
  let extraOffers;
  const aeInput = parsed.data.aeProduct?.trim();
  if (aeInput) {
    const productId = parseProductId(aeInput);
    if (!productId) return NextResponse.json({ error: "AE_LINK_INVALID" }, { status: 400 });
    try {
      const s = await openSession(user.supplierAccounts, "ALIEXPRESS");
      if (s.supplier !== "ALIEXPRESS") throw new SupplierError("SUPPLIER_UNSUPPORTED");
      extraOffers = await offersFor(s.cfg, s.session, productId, m.country);
    } catch (e) {
      if (e instanceof SupplierError) return NextResponse.json({ error: e.code === "SUPPLIER_RECONNECT" ? "SUPPLIER_RECONNECT" : "AE_NOT_CONNECTED" }, { status: 400 });
      console.error("Finder AliExpress", e);
      if (isQuotaError(e)) return NextResponse.json({ error: "EBAY_QUOTA" }, { status: 503 });
      return NextResponse.json({ error: "UPSTREAM" }, { status: 502 });
    }
  }

  const cjAccount = user.supplierAccounts.find((a: { supplier: string }) => a.supplier === "CJ");
  try {
    const result = await findProduct(parsed.data.keyword, {
      cjToken: cjAccount ? decrypt(cjAccount.accessToken) : undefined,
      minMarginPct: user.minMarginPct,
      marketId: m.id,
      extraOffers,
    });
    return NextResponse.json(result);
  } catch (e) {
    console.error("Finder", e);
    if (isQuotaError(e)) return NextResponse.json({ error: "EBAY_QUOTA" }, { status: 503 });
    return NextResponse.json({ error: "UPSTREAM" }, { status: 502 });
  }
}
