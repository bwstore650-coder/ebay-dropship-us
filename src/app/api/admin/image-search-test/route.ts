import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { isAdminEmail, parseAdminEmails } from "@/lib/admin";
import { getAppToken } from "@/lib/ebay";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * TEMPORAIRE (admin) : vérifie que la recherche eBay par image (Browse searchByImage) est ouverte à nos clés.
 * ?image=<URL https d'une photo CJ>. À supprimer après le test.
 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user || !isAdminEmail(user.email, parseAdminEmails(process.env.ADMIN_EMAILS)))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const url = new URL(req.url).searchParams.get("image") ?? "";
  if (!/^https:\/\/[^/]*(cjdropshipping\.com|cjdropshipping\.cn|ebayimg\.com|aliexpress-media\.com|alicdn\.com)\//.test(url))
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const img = await fetch(url);
  if (!img.ok) return NextResponse.json({ error: "IMAGE_FETCH", status: img.status }, { status: 502 });
  const base64 = Buffer.from(await img.arrayBuffer()).toString("base64");
  const started = Date.now();
  const res = await fetch("https://api.ebay.com/buy/browse/v1/item_summary/search_by_image?limit=20&filter=buyingOptions:{FIXED_PRICE},conditions:{NEW}", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await getAppToken()}`,
      "Content-Type": "application/json",
      "Accept-Language": "en-US",
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    },
    body: JSON.stringify({ image: base64 }),
  });
  const text = await res.text();
  let data: { total?: number; itemSummaries?: { title: string; price?: { value: string }; itemWebUrl?: string }[]; errors?: unknown } = {};
  try { data = JSON.parse(text); } catch { /* texte brut */ }
  return NextResponse.json({
    httpStatus: res.status,
    ms: Date.now() - started,
    imageKb: Math.round(base64.length / 1365),
    total: data.total ?? null,
    items: (data.itemSummaries ?? []).map((i) => ({ title: i.title, price: i.price?.value, url: i.itemWebUrl })),
    errors: data.errors ?? (res.ok ? undefined : text.slice(0, 1500)),
  });
}
