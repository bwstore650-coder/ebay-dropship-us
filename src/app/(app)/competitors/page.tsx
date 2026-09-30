import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getI18n } from "@/lib/i18n/server";
import { marketplace, MARKETPLACE_IDS } from "@/lib/marketplaces";
import CompetitorsClient from "@/components/CompetitorsClient";

export const dynamic = "force-dynamic";

export default async function CompetitorsPage({ searchParams }: { searchParams: Promise<{ u?: string; m?: string }> }) {
  const user = await requireUser();
  const { locale, t } = await getI18n();
  const { u, m } = await searchParams;
  const saved = await db.savedSeller.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
  return (
    <CompetitorsClient
      t={t.research}
      markets={t.markets}
      errors={t.errors}
      locale={locale}
      marketIds={MARKETPLACE_IDS}
      defaultMarket={marketplace(m ?? user.defaultMarketplace).id}
      initialSeller={u?.slice(0, 200)}
      saved={saved.map((s) => ({ username: s.username, market: marketplace(s.marketplace).id }))}
    />
  );
}
