import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { isQuotaError } from "@/lib/ebay";
import { cachedImageDemand } from "@/lib/ebay-quota";
import { isMarketplaceId, marketplace, type MarketplaceId } from "@/lib/marketplaces";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Photos de fournisseurs acceptées (pas de requête vers une adresse quelconque). */
const IMAGE_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(cjdropshipping\.com|cjdropshipping\.cn|alicdn\.com|aliexpress-media\.com)\//i;

/**
 * Les 5 annonces eBay les plus proches d'un produit (trouvées par sa photo), lues en direct ou depuis
 * le cache de 6 h : rien n'est gardé plus longtemps (contrat eBay). ?image=&kw=&m=
 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const image = q.get("image") ?? "";
  const kw = (q.get("kw") ?? "").slice(0, 120).trim();
  const m = q.get("m") ?? "";
  if (!IMAGE_HOSTS.test(image) || !kw) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const marketId = marketplace(isMarketplaceId(m) ? (m as MarketplaceId) : user.defaultMarketplace).id;
  try {
    const d = await cachedImageDemand(image, kw, 10, marketId);
    const sold = new Map(d.analyzed.map((a) => [a.id, a.sold]));
    return NextResponse.json({
      method: d.method ?? "KEYWORD",
      items: d.items.slice(0, 5).map((i) => ({ id: i.id, title: i.title, price: Math.round(i.price * 100) / 100, url: i.url ?? null, image: i.image ?? null, sold: sold.get(i.id) ?? null })),
    });
  } catch (e) {
    if (isQuotaError(e)) return NextResponse.json({ error: "EBAY_QUOTA" }, { status: 503 });
    console.error("Annonces comparables", e);
    return NextResponse.json({ error: "UPSTREAM" }, { status: 502 });
  }
}
