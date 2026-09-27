import { requireUser } from "@/lib/auth";
import { PLANS, TRIAL_DAYS } from "@/lib/plans";
import { fmt, LOCALE_TAGS } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import PlanPicker from "@/components/PlanPicker";

export default async function Billing() {
  const user = await requireUser();
  const { locale, t } = await getI18n();
  const planName = user.plan === "NONE" ? t.plans.none : t.plans[user.plan];
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t.billing.title}</h1>
      <p className="text-slate-600">
        {t.billing.current} <strong>{planName}</strong>
        {user.trialEndsAt && ` · ${fmt(t.billing.trialUntil, { date: user.trialEndsAt.toLocaleDateString(LOCALE_TAGS[locale]) })}`}
      </p>
      <PlanPicker
        plans={PLANS}
        currentPlan={user.plan}
        trialDays={TRIAL_DAYS}
        trialEligible={!user.trialEndsAt && !user.stripeSubscriptionId}
        t={t.billing}
        tPlans={t.plans}
        errors={t.errors}
      />
      {user.stripeCustomerId && (
        <form action="/api/stripe/portal" method="post">
          <button className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">{t.billing.manage}</button>
        </form>
      )}
    </div>
  );
}
