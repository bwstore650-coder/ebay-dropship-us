import { requireUser } from "@/lib/auth";
import { PLANS, TRIAL_DAYS } from "@/lib/plans";
import PlanPicker from "@/components/PlanPicker";

export default async function Billing() {
  const user = await requireUser();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Abonnement</h1>
      <p className="text-slate-600">
        Formule actuelle : <strong>{user.plan === "NONE" ? "aucune" : PLANS.find((p) => p.id === user.plan)?.name}</strong>
        {user.trialEndsAt && ` · essai jusqu'au ${user.trialEndsAt.toLocaleDateString("fr-FR")}`}
      </p>
      <PlanPicker plans={PLANS} currentPlan={user.plan} trialDays={TRIAL_DAYS} trialEligible={!user.trialEndsAt && !user.stripeSubscriptionId} />
      {user.stripeCustomerId && (
        <form action="/api/stripe/portal" method="post">
          <button className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">Changer de formule ou gérer mon abonnement</button>
        </form>
      )}
    </div>
  );
}
