import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { isAdminEmail, parseAdminEmails } from "@/lib/admin";
import { openSession } from "@/lib/suppliers";
import * as ae from "@/lib/suppliers/aliexpress";
import { imageBase64 } from "@/lib/ebay-quota";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Diagnostic temporaire (admin) : recherche AliExpress pour un mot-clé, sans aucun appel eBay.
 * Montre d'où partent les variantes (entrepôt) et si la recherche par photo répond. Aucune donnée secrète renvoyée.
 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user || !isAdminEmail(user.email, parseAdminEmails(process.env.ADMIN_EMAILS)))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const q = new URL(req.url).searchParams.get("q")?.slice(0, 80) || "car phone holder";
  const s = await openSession(user.supplierAccounts, "ALIEXPRESS");
  if (s.supplier !== "ALIEXPRESS") return NextResponse.json({ error: "NO_AE" });
  const out: Record<string, unknown> = { q };
  const items = await ae.textSearch(s.cfg, s.session, { keyword: q, country: "US", pageSize: 10 }).catch((e) => { out.textError = String(e); return []; });
  out.text = items.slice(0, 10).map((i) => ({ id: i.productId, title: i.title.slice(0, 60), price: i.price, orders: i.orders }));
  const products = [];
  for (const it of items.slice(0, 4)) {
    try {
      const raw = await ae.call(s.cfg, "aliexpress.ds.product.get", s.session, { product_id: it.productId, ship_to_country: "US", target_currency: "USD", target_language: "en" });
      const p = ae.parseProduct(raw);
      const rawSkus = ((raw as { result?: { ae_item_sku_info_dtos?: unknown } }).result?.ae_item_sku_info_dtos ?? null);
      products.push({
        id: it.productId,
        skus: p.skus.slice(0, 6).map((k) => ({ label: k.label, shipsFrom: k.shipsFrom, stock: k.stock, price: k.price })),
        rawSkuSample: JSON.stringify(rawSkus).slice(0, 1200),
        rawKeys: Object.keys((raw as { result?: object }).result ?? raw),
      });
    } catch (e) {
      products.push({ id: it.productId, error: String(e) });
    }
  }
  out.products = products;
  const img = items[0]?.image ? await imageBase64(items[0].image) : null;
  if (img) {
    try {
      const raw = await ae.call(s.cfg, "aliexpress.ds.image.searchV2", s.session, { param0: { image_base64: img, ship_to: "US", currency: "USD", lang: "en", search_type: "same" } });
      out.imageRaw = JSON.stringify(raw).slice(0, 1500);
      const m = await ae.imageSearch(s.cfg, s.session, { imageBase64: img, country: "US" });
      out.image = m.slice(0, 10).map((x) => ({ id: x.productId, shipFrom: x.shipFrom, sim: x.similarity }));
    } catch (e) {
      out.imageError = String(e);
    }
  } else out.imageError = "no image";
  return NextResponse.json(out);
}
