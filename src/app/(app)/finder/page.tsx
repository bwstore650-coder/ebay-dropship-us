import { requireUser } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";
import { marketplace, MARKETPLACE_IDS } from "@/lib/marketplaces";
import FinderClient from "@/components/FinderClient";

export default async function FinderPage() {
  const user = await requireUser();
  const { t } = await getI18n();
  return (
    <FinderClient
      t={t.finder}
      markets={t.markets}
      errors={t.errors}
      marketIds={MARKETPLACE_IDS}
      defaultMarket={marketplace(user.defaultMarketplace).id}
    />
  );
}
