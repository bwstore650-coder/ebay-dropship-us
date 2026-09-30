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
        const v = p.variants?.find((x) => x.inventories?.some((i) => i.countryCode === "US" && i.totalInventory > 0));
        if (v) {
          try {
            const f = await cj.freightCalculate(token, v.vid, 1, "US");
            row.freight = f.slice(0, 3);
          } catch (e) { row.freightError = String(e); }
        }
      } catch (e) { row.productError = String(e); }
      (out.items as unknown[]).push(row);
    }
  } catch (e) { out.listError = String(e); }
  return NextResponse.json(out);
}
