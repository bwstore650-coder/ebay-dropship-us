import { currentUser } from "@/lib/auth";
import { PLANS, TRIAL_DAYS } from "@/lib/plans";
import PlanButton from "@/components/PlanButton";

export default async function Billing() {
  const user = (await currentUser())!;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Abonnement</h1>
      <p className="text-slate-600">
        Formule actuelle : <strong>{user.plan === "NONE" ? "aucune" : user.plan}</strong>
        {user.trialEndsAt && ` · essai jusqu'au ${user.trialEndsAt.toLocaleDateString("fr-FR")}`}
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        {PLANS.map((p) => (
          <div key={p.id} className={`rounded-xl border bg-white p-6 ${user.plan === p.id ? "border-blue-600" : "border-slate-200"}`}>
            <h2 className="font-semibold">{p.name}</h2>
            <p className="mt-1 text-2xl font-bold">{p.priceUsd} $/mois</p>
            <p className="mt-2 text-sm text-slate-600">{p.listingsPerMonth ?? "Illimité"} annonces · {p.autoOrdersPerMonth ?? "Illimité"} commandes auto</p>
            {user.plan === "NONE" && <PlanButton plan={p.id} label={`Essai gratuit ${TRIAL_DAYS} jours`} />}
          </div>
        ))}
      </div>
      {user.stripeCustomerId && (
        <form action="/api/stripe/portal" method="post">
          <button className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">Gérer mon abonnement</button>
        </form>
      )}
    </div>
  );
}
