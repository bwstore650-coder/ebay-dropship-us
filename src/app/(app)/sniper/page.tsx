import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmt } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { marketplace, MARKETPLACE_IDS } from "@/lib/marketplaces";
import { runState } from "@/lib/sniper-service";
import SniperClient from "@/components/SniperClient";

export const dynamic = "force-dynamic";

export default async function SniperPage() {
  const user = await requireUser();
  const { t } = await getI18n();
  const last = await db.snipeRun.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, select: { id: true } });
  const hasGpsr = Boolean(user.euRpCompany && user.euRpAddress && user.euRpCity && user.euRpPostalCode && user.euRpCountry && user.euRpEmail);
  return (
    <SniperClient
      t={t.sniper}
      tl={t.listing}
      markets={t.markets}
      errors={t.errors}
      marketIds={MARKETPLACE_IDS}
      defaultMarket={marketplace(user.defaultMarketplace).id}
      minMargin={user.minMarginPct}
      cjConnected={user.supplierAccounts.some((a) => a.supplier === "CJ")}
      accounts={user.ebayAccounts.map((a, i) => ({ id: a.id, label: a.label ?? a.ebayUserId ?? fmt(t.settings.ebayAccountN, { n: i + 1 }) }))}
      hasGpsr={hasGpsr}
      initial={last ? await runState(user.id, last.id) : null}
    />
  );
}
