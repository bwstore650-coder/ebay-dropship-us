import { fmt, type Dict } from "@/lib/i18n";
import type { PlanInfo } from "@/lib/plans";

/** Liste des avantages d'une formule (partagée par l'accueil et la page abonnement). */
export default function PlanFeatures({ plan, t }: { plan: PlanInfo; t: Dict["plans"] }) {
  return (
    <ul className="mt-3 space-y-1 text-sm text-slate-600">
      <li>{plan.listingsPerMonth === null ? t.unlimitedListings : fmt(t.listings, { n: plan.listingsPerMonth })}</li>
      <li>{plan.autoOrdersPerMonth === null ? t.unlimitedOrders : fmt(t.orders, { n: plan.autoOrdersPerMonth })}</li>
      <li>{plan.maxEbayAccounts === 1 ? t.accountsOne : fmt(t.accountsMany, { n: plan.maxEbayAccounts })}</li>
      <li>{t.marginFilter}</li>
    </ul>
  );
}
