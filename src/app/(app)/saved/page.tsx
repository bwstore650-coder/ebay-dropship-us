import { requireUser } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";
import { marketplace } from "@/lib/marketplaces";
import { listSaved, MAX_SAVED } from "@/lib/saved-products";
import SavedClient from "@/components/SavedClient";

export const dynamic = "force-dynamic";

/** Produits sauvegardés depuis le Sniper, les produits gagnants, le High ticket ou l'extension. */
export default async function SavedPage() {
  const user = await requireUser();
  const { t, locale } = await getI18n();
  const items = await listSaved(user.id);
  return (
    <SavedClient
      t={t.saved}
      errors={t.errors}
      locale={locale}
      max={MAX_SAVED}
      defaultMarket={marketplace(user.defaultMarketplace).id}
      initial={items.map((i) => ({
        id: i.id, supplier: i.supplier, productId: i.productId, title: i.title, image: i.image, keyword: i.keyword,
        marketId: i.marketId, price: i.price, cost: i.cost, profit: i.profit, marginPct: i.marginPct, createdAt: i.createdAt.toISOString(),
      }))}
    />
  );
}
