import { requireUser } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";
import { marketplace, MARKETPLACE_IDS } from "@/lib/marketplaces";
import TitleBuilderClient from "@/components/TitleBuilderClient";

export default async function TitleBuilderPage({ searchParams }: { searchParams: Promise<{ q?: string; m?: string }> }) {
  const user = await requireUser();
  const { locale, t } = await getI18n();
  const { q, m } = await searchParams;
  return (
    <TitleBuilderClient
      t={t.research}
      markets={t.markets}
      errors={t.errors}
      locale={locale}
      marketIds={MARKETPLACE_IDS}
      defaultMarket={marketplace(m ?? user.defaultMarketplace).id}
      initialKeyword={q?.slice(0, 120)}
    />
  );
}
