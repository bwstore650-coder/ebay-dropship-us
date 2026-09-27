import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { COMMISSION_RATE, HOLD_DAYS, MIN_PAYOUT_CENTS, newReferralCode, totals } from "@/lib/affiliate";
import { fmt } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default async function Affiliate() {
  const user = await requireUser();
  const { t } = await getI18n();
  const a = t.affiliate;
  // Les comptes créés avant l'affiliation reçoivent leur code à la première visite.
  const code = user.referralCode ?? (await db.user.update({ where: { id: user.id }, data: { referralCode: newReferralCode() } })).referralCode!;
  const [referrals, paying, commissions] = await Promise.all([
    db.user.count({ where: { referredById: user.id } }),
    db.user.count({ where: { referredById: user.id, plan: { not: "NONE" } } }),
    db.commission.findMany({ where: { affiliateId: user.id }, orderBy: { createdAt: "desc" } }),
  ]);
  const sum = totals(commissions);
  const link = `${env().APP_URL}/?ref=${code}`;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{a.title}</h1>
      <p className="text-slate-600">{fmt(a.intro, { rate: COMMISSION_RATE * 100, days: HOLD_DAYS, min: usd(MIN_PAYOUT_CENTS) })}</p>
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
        <p className="text-sm text-slate-500">{a.yourLink}</p>
        <p className="mt-1 break-all font-mono text-brand-700">{link}</p>
      </section>
      <section className="grid gap-4 sm:grid-cols-3">
        <Stat label={a.signups} value={String(referrals)} />
        <Stat label={a.paying} value={String(paying)} />
        <Stat label={a.pending} value={usd(sum.pendingCents)} />
        <Stat label={a.payable} value={usd(sum.payableCents)} />
        <Stat label={a.paid} value={usd(sum.paidCents)} />
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}
