import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { cleanSaveInput, cleanSavedId, listSaved, removeSaved, SavedError, savedKeys, saveProduct } from "@/lib/saved-products";

export const dynamic = "force-dynamic";

const fail = (code: string, status = 400) => NextResponse.json({ error: code }, { status });

/** Produits sauvegardés : ?keys=1 ne renvoie que les clés (« CJ:id ») pour marquer les fiches déjà gardées. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (new URL(req.url).searchParams.get("keys") === "1") return NextResponse.json({ keys: await savedKeys(user.id) });
  return NextResponse.json({ items: await listSaved(user.id) });
}

/** Sauvegarde un produit avec un instantané de son analyse. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  const input = cleanSaveInput(await req.json().catch(() => null));
  if (!input) return fail("INVALID_INPUT");
  try {
    const item = await saveProduct(user.id, input);
    return NextResponse.json({ item });
  } catch (e) {
    if (e instanceof SavedError) return fail(e.code);
    throw e;
  }
}

/** Retire un produit (?supplier=CJ&productId=…) ou tous (?all=1). */
export async function DELETE(req: Request) {
  const user = await currentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  const q = new URL(req.url).searchParams;
  if (q.get("all") === "1") return NextResponse.json({ deleted: await removeSaved(user.id, "all") });
  const productId = cleanSavedId(q.get("productId"));
  const supplier = q.get("supplier") === "ALIEXPRESS" ? "ALIEXPRESS" : "CJ";
  if (!productId) return fail("INVALID_INPUT");
  return NextResponse.json({ deleted: await removeSaved(user.id, { supplier, productId }) });
}
