import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { COMMISSION_RATE, HOLD_DAYS, MIN_PAYOUT_CENTS, newReferralCode, totals } from "@/lib/affiliate";
import { fmt } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { StatCard } from "@/components/ui";

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
      <h1 className="text-2xl font-semibold tracking-tight text-fg sm:text-[28px]">{a.title}</h1>
      <p className="max-w-3xl text-sm text-muted">{fmt(a.intro, { rate: COMMISSION_RATE * 100, days: HOLD_DAYS, min: usd(MIN_PAYOUT_CENTS) })}</p>
      <section className="card border-brand-500/30 bg-gradient-to-br from-brand-500/10 to-transparent">
        <p className="eyebrow">{a.yourLink}</p>
        <p className="mt-2 break-all font-mono text-[15px] text-brand-200">{link}</p>
      </section>
      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <StatCard label={a.signups} value={String(referrals)} icon="users" tone="sky" />
        <StatCard label={a.paying} value={String(paying)} icon="card" tone="brand" />
        <StatCard label={a.pending} value={usd(sum.pendingCents)} icon="refresh" tone="amber" />
        <StatCard label={a.payable} value={usd(sum.payableCents)} icon="dollar" tone="emerald" />
        <StatCard label={a.paid} value={usd(sum.paidCents)} icon="check" tone="fuchsia" />
      </section>
    </div>
  );
}
