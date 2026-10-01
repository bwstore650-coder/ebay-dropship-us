import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { cleanProductId, ExtensionError } from "@/lib/extension";
import { extRoute, readJson } from "@/lib/extension-route";

export const dynamic = "force-dynamic";

/** Taille maximum de la liste d'idées. */
const MAX_SAVED = 200;

/** Liste d'idées (les plus récentes d'abord). */
export const GET = extRoute(async (user) => {
  const items = await db.savedProduct.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: MAX_SAVED });
  return NextResponse.json({ items });
});

/** Ajoute un produit : { productId, title?, image? }. */
export const POST = extRoute(async (user, req) => {
  const b = await readJson(req);
  const productId = cleanProductId(b?.productId);
  if (!productId) throw new ExtensionError("INVALID_INPUT");
  const title = typeof b?.title === "string" ? b.title.slice(0, 300) : null;
  const image = typeof b?.image === "string" && /^https:\/\//.test(b.image) ? b.image.slice(0, 500) : null;
  const count = await db.savedProduct.count({ where: { userId: user.id } });
  const exists = await db.savedProduct.findUnique({ where: { userId_supplier_productId: { userId: user.id, supplier: "CJ", productId } } });
  if (!exists && count >= MAX_SAVED) return NextResponse.json({ error: "SAVED_FULL" }, { status: 400 });
  const item = await db.savedProduct.upsert({
    where: { userId_supplier_productId: { userId: user.id, supplier: "CJ", productId } },
    create: { userId: user.id, supplier: "CJ", productId, title, image },
    update: { ...(title ? { title } : {}), ...(image ? { image } : {}) },
  });
  return NextResponse.json({ item });
});

/** Retire un produit (?productId=…) ou vide la liste (?all=1). */
export const DELETE = extRoute(async (user, req) => {
  const q = new URL(req.url).searchParams;
  const productId = cleanProductId(q.get("productId"));
  if (!productId && q.get("all") !== "1") throw new ExtensionError("INVALID_INPUT");
  const r = await db.savedProduct.deleteMany({ where: { userId: user.id, ...(productId ? { productId } : {}) } });
  return NextResponse.json({ deleted: r.count });
});
