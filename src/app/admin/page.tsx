import { db } from "@/lib/db";
import { dailyCounts, isTrialing, money, mrrCents } from "@/lib/admin";
import { totals } from "@/lib/affiliate";
import { PLANS } from "@/lib/plans";
import { Bars, Card, Kpi } from "@/components/admin/Kpi";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const now = new Date();
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const [users, recentSignups, leadsBySource, leadsTotal, commissions] = await Promise.all([
    db.user.findMany({ select: { plan: true, billingInterval: true, trialEndsAt: true } }),
    db.user.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
    db.lead.groupBy({ by: ["source"], _count: { _all: true } }),
    db.lead.count(),
    db.commission.findMany({ select: { amountCents: true, status: true, availableAt: true } }),
  ]);

  const mrr = mrrCents(users, now);
  const paying = users.filter((u) => u.plan !== "NONE" && !isTrialing(u, now)).length;
  const trialing = users.filter((u) => isTrialing(u, now)).length;
  const byPlan = PLANS.map((p) => ({
    plan: p.id,
    monthly: users.filter((u) => u.plan === p.id && u.billingInterval !== "year").length,
    yearly: users.filter((u) => u.plan === p.id && u.billingInterval === "year").length,
  }));
  const aff = totals(commissions, now);
  const signups = dailyCounts(recentSignups.map((u) => u.createdAt), 30, now);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-fg sm:text-[28px]">Vue d&apos;ensemble</h1>
        <p className="text-sm text-muted">Chiffres en direct depuis la base (abonnements synchronisés par le webhook Stripe).</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi accent label="Revenu mensuel récurrent (MRR)" value={money(mrr)} hint={`Soit ${money(mrr * 12)} par an · objectif 100 000 $/mois`} />
        <Kpi label="Clients payants" value={String(paying)} hint="Essais exclus" />
        <Kpi label="Essais en cours" value={String(trialing)} />
        <Kpi label="Comptes créés" value={String(users.length)} hint={`${recentSignups.length} ces 30 derniers jours`} />
        <Kpi label="Emails récoltés" value={String(leadsTotal)} />
        <Kpi label="Commissions à verser" value={money(aff.payableCents)} hint={`${money(aff.pendingCents)} en période de garantie`} />
        <Kpi label="Commissions déjà versées" value={money(aff.paidCents)} />
        <Kpi label="Progression vers 100 k$/mois" value={`${((mrr / 10_000_000) * 100).toFixed(2)} %`} />
      </div>

      <Card title="Inscriptions par jour (30 derniers jours)">
        <Bars data={signups} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Clients par formule">
          <table className="w-full text-sm">
            <thead className="text-left text-muted">
              <tr><th className="pb-2">Formule</th><th className="pb-2 text-right">Mensuel</th><th className="pb-2 text-right">Annuel</th></tr>
            </thead>
            <tbody>
              {byPlan.map((r) => (
                <tr key={r.plan} className="border-t border-line">
                  <td className="py-2 font-medium">{r.plan}</td>
                  <td className="py-2 text-right">{r.monthly}</td>
                  <td className="py-2 text-right">{r.yearly}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Emails par source" action={<a className="text-sm text-brand-400" href="/api/admin/leads">Exporter CSV</a>}>
          <table className="w-full text-sm">
            <tbody>
              {leadsBySource.length === 0 && <tr><td className="text-muted">Aucun email pour l&apos;instant.</td></tr>}
              {leadsBySource.map((l) => (
                <tr key={l.source} className="border-t border-line">
                  <td className="py-2">{l.source}</td>
                  <td className="py-2 text-right font-medium">{l._count._all}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
