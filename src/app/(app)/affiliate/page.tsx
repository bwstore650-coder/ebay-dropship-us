import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { COMMISSION_RATE, HOLD_DAYS, MIN_PAYOUT_CENTS, newReferralCode, totals } from "@/lib/affiliate";

const usd = (cents: number) => `${(cents / 100).toFixed(2)} $`;

export default async function Affiliate() {
  const user = await requireUser();
  // Les comptes créés avant l'affiliation reçoivent leur code à la première visite.
  const code = user.referralCode ?? (await db.user.update({ where: { id: user.id }, data: { referralCode: newReferralCode() } })).referralCode!;
  const [referrals, paying, commissions] = await Promise.all([
    db.user.count({ where: { referredById: user.id } }),
    db.user.count({ where: { referredById: user.id, plan: { not: "NONE" } } }),
    db.commission.findMany({ where: { affiliateId: user.id }, orderBy: { createdAt: "desc" } }),
  ]);
  const t = totals(commissions);
  const link = `${env().APP_URL}/?ref=${code}`;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Programme d&apos;affiliation</h1>
      <p className="text-slate-600">
        Gagne {COMMISSION_RATE * 100} % de chaque paiement de tes filleuls, à vie. Les commissions sont disponibles {HOLD_DAYS} jours
        après le paiement (garantie remboursement), versement dès {usd(MIN_PAYOUT_CENTS)}.
      </p>
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <p className="text-sm text-slate-500">Ton lien</p>
        <p className="mt-1 break-all font-mono text-blue-700">{link}</p>
      </section>
      <section className="grid gap-4 sm:grid-cols-3">
        <Stat label="Inscrits avec ton lien" value={String(referrals)} />
        <Stat label="Clients payants" value={String(paying)} />
        <Stat label="En attente (garantie)" value={usd(t.pendingCents)} />
        <Stat label="À verser" value={usd(t.payableCents)} />
        <Stat label="Déjà versé" value={usd(t.paidCents)} />
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}
