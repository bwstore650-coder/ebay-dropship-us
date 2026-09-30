import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { isAdminEmail, parseAdminEmails } from "@/lib/admin";
import { decrypt } from "@/lib/crypto";
import * as cj from "@/lib/suppliers/cj";

/** Diagnostic admin (temporaire) : ce que CJ renvoie pour un mot-clé, sans aucun secret. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user || !isAdminEmail(user.email, parseAdminEmails(process.env.ADMIN_EMAILS)))
    return new NextResponse("Not found", { status: 404 });
  const acc = user.supplierAccounts.find((a: { supplier: string }) => a.supplier === "CJ");
  if (!acc) return NextResponse.json({ error: "NO_CJ" });
  const token = decrypt(acc.accessToken);
  const keyword = new URL(req.url).searchParams.get("keyword") ?? "phone holder";
  const out: Record<string, unknown> = { keyword };
  try {
    const list = (await cj.searchProducts(token, keyword, 1, 3, "US")) as { totalRecords?: number; content?: { productList?: { id?: string; nameEn?: string; warehouseInventoryNum?: number }[] }[] };
    out.totalRecords = list.totalRecords;
    out.listKeys = Object.keys(list ?? {});
    const items = list.content?.[0]?.productList ?? [];
    out.items = [];
    for (const it of items.slice(0, 2)) {
      const row: Record<string, unknown> = { id: it.id, name: it.nameEn, warehouseInventoryNum: it.warehouseInventoryNum };
      try {
        const p = await cj.getProduct(token, String(it.id));
        row.variants = p.variants?.length;
        row.inventories = p.variants?.slice(0, 3).map((v) => v.inventories);
        await new Promise((r) => setTimeout(r, 1200));
        const q = new URLSearchParams({ pid: String(it.id), countryCode: "US" });
        const r1 = await fetch(`https://developers.cjdropshipping.com/api2.0/v1/product/query?${q}`, { headers: { "CJ-Access-Token": token } });
        const j1 = await r1.json();
        row.usMsg = j1?.message;
        row.usVariants = j1?.data?.variants?.length;
        row.usVariantKeys = j1?.data?.variants?.[0] ? Object.keys(j1.data.variants[0]) : null;
        row.usInv = j1?.data?.variants?.[0]?.inventories ?? null;
        const v = j1?.data?.variants?.[0];
        if (v) {
          await new Promise((r) => setTimeout(r, 1200));
          const r2 = await fetch(`https://developers.cjdropshipping.com/api2.0/v1/product/stock/queryByVid?vid=${encodeURIComponent(v.vid)}`, { headers: { "CJ-Access-Token": token } });
          const js = await r2.json().catch(() => null); row.stock = js?.data;
          await new Promise((r) => setTimeout(r, 1200));
          try {
            const f = await cj.freightCalculate(token, v.vid, 1, "US");
            row.freight = f.slice(0, 4).map((o) => ({ n: o.logisticName, p: o.logisticPrice, a: o.logisticAging }));
            row.sell = v.variantSellPrice;
            row.weight = v.variantWeight;
            for (const zip of ["90001", "10001"]) {
              await new Promise((r) => setTimeout(r, 1200));
              const r3 = await fetch("https://developers.cjdropshipping.com/api2.0/v1/logistic/freightCalculate", {
                method: "POST",
                headers: { "Content-Type": "application/json", "CJ-Access-Token": token },
                body: JSON.stringify({ startCountryCode: "US", endCountryCode: "US", zip, products: [{ vid: v.vid, quantity: 1 }] }),
              });
              const j3 = await r3.json();
              row[`zip${zip}`] = j3?.message + " " + JSON.stringify((j3?.data ?? []).slice(0, 4).map((o: { logisticName: string; logisticPrice: number; postage: number; totalPostageFee: number }) => [o.logisticName, o.logisticPrice, o.postage, o.totalPostageFee]));
            }
          } catch (e) { row.freightError = String(e); }
        }
      } catch (e) { row.productError = String(e); }
      (out.items as unknown[]).push(row);
    }
  } catch (e) { out.listError = String(e); }
  return NextResponse.json(out);
}
