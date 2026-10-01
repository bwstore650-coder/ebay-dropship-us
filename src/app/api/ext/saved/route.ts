import { NextResponse } from "next/server";
import { cleanProductId, ExtensionError } from "@/lib/extension";
import { extRoute, readJson } from "@/lib/extension-route";
import { cleanSaveInput, listSaved, removeSaved, saveProduct } from "@/lib/saved-products";

export const dynamic = "force-dynamic";

/** Liste d'idées (les plus récentes d'abord) : la même que « Produits sauvegardés » sur le site. */
export const GET = extRoute(async (user) => NextResponse.json({ items: await listSaved(user.id) }));

/** Ajoute un produit CJ : { productId, title?, image? }. */
export const POST = extRoute(async (user, req) => {
  const b = await readJson(req);
  const input = cleanSaveInput({ productId: b?.productId, title: b?.title, image: b?.image, supplier: "CJ" });
  if (!input) throw new ExtensionError("INVALID_INPUT");
  return NextResponse.json({ item: await saveProduct(user.id, input) });
});

/** Retire un produit (?productId=…) ou vide la liste (?all=1). */
export const DELETE = extRoute(async (user, req) => {
  const q = new URL(req.url).searchParams;
  const productId = cleanProductId(q.get("productId"));
  if (!productId && q.get("all") !== "1") throw new ExtensionError("INVALID_INPUT");
  return NextResponse.json({ deleted: await removeSaved(user.id, productId ? { productId } : "all") });
});
