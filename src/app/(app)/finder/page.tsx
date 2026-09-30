import { requireUser } from "@/lib/auth";
import { fmt } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { marketplace, MARKETPLACE_IDS } from "@/lib/marketplaces";
import FinderClient from "@/components/FinderClient";

export default async function FinderPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const user = await requireUser();
  const { t } = await getI18n();
  const hasGpsr = Boolean(user.euRpCompany && user.euRpAddress && user.euRpCity && user.euRpPostalCode && user.euRpCountry && user.euRpEmail);
  return (
    <FinderClient
      t={t.finder}
      tl={t.listing}
      markets={t.markets}
      errors={t.errors}
      marketIds={MARKETPLACE_IDS}
      defaultMarket={marketplace(user.defaultMarketplace).id}
      accounts={user.ebayAccounts.map((a, i) => ({ id: a.id, label: a.label ?? a.ebayUserId ?? fmt(t.settings.ebayAccountN, { n: i + 1 }) }))}
      hasGpsr={hasGpsr}
      initialKeyword={q?.slice(0, 200)}
      aeConnected={user.supplierAccounts.some((a) => a.supplier === "ALIEXPRESS")}
    />
  );
}
