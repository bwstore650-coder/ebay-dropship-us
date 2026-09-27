import { db } from "@/lib/db";
import { money } from "@/lib/admin";
import { MIN_PAYOUT_CENTS, totals } from "@/lib/affiliate";
import { Card } from "@/components/admin/Kpi";
import { markAffiliatePaid, voidCommission } from "../actions";

export const dynamic = "force-dynamic";

export default async function AdminAffiliates() {
  const now = new Date();
  const affiliates = await db.user.findMany({
    where: { OR: [{ referrals: { some: {} } }, { commissionsEarned: { some: {} } }] },
    select: {
      id: true, email: true, referralCode: true,
      _count: { select: { referrals: true } },
      referrals: { where: { plan: { not: "NONE" } }, select: { id: true } },
      commissionsEarned: { select: { id: true, amountCents: true, status: true, availableAt: true, createdAt: true, referredUser: { select: { email: true } } }, orderBy: { createdAt: "desc" } },
    },
  });
  const rows = affiliates
    .map((a) => ({ ...a, sum: totals(a.commissionsEarned, now) }))
    .sort((x, y) => y.sum.payableCents - x.sum.payableCents || y._count.referrals - x._count.referrals);
  const open = rows.flatMap((a) => a.commissionsEarned.filter((c) => c.status === "PENDING" || c.status === "PAYABLE").map((c) => ({ ...c, affiliate: a.email })));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Affiliés</h1>
        <p className="text-sm text-slate-500">
          Verse les commissions « à verser » par PayPal ou virement (minimum {money(MIN_PAYOUT_CENTS)}), puis clique sur « Marquer payé ».
        </p>
      </div>

      <Card title={`${rows.length} affiliés`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="pb-2">Affilié</th><th className="pb-2">Code</th><th className="pb-2 text-right">Inscrits</th>
                <th className="pb-2 text-right">Payants</th><th className="pb-2 text-right">En garantie</th>
                <th className="pb-2 text-right">À verser</th><th className="pb-2 text-right">Versé</th><th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={8} className="py-4 text-slate-500">Aucun affilié pour l&apos;instant.</td></tr>}
              {rows.map((a) => (
                <tr key={a.id} className="border-t border-slate-100">
                  <td className="py-2 font-medium">{a.email}</td>
                  <td className="py-2 font-mono text-slate-500">{a.referralCode}</td>
                  <td className="py-2 text-right">{a._count.referrals}</td>
                  <td className="py-2 text-right">{a.referrals.length}</td>
                  <td className="py-2 text-right">{money(a.sum.pendingCents)}</td>
                  <td className="py-2 text-right font-semibold">{money(a.sum.payableCents)}</td>
                  <td className="py-2 text-right">{money(a.sum.paidCents)}</td>
                  <td className="py-2 text-right">
                    {a.sum.payableCents >= MIN_PAYOUT_CENTS && (
                      <form action={markAffiliatePaid}>
                        <input type="hidden" name="affiliateId" value={a.id} />
                        <button className="rounded-lg bg-green-600 px-3 py-1 text-xs font-semibold text-white">Marquer payé</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Commissions ouvertes">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-slate-500">
              <tr><th className="pb-2">Affilié</th><th className="pb-2">Client</th><th className="pb-2 text-right">Montant</th><th className="pb-2">Disponible le</th><th className="pb-2" /></tr>
            </thead>
            <tbody>
              {open.length === 0 && <tr><td colSpan={5} className="py-4 text-slate-500">Aucune commission ouverte.</td></tr>}
              {open.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="py-2">{c.affiliate}</td>
                  <td className="py-2 text-slate-500">{c.referredUser.email}</td>
                  <td className="py-2 text-right font-medium">{money(c.amountCents)}</td>
                  <td className="py-2">{c.availableAt <= now ? <span className="text-green-700">Disponible</span> : c.availableAt.toLocaleDateString("fr-FR")}</td>
                  <td className="py-2 text-right">
                    <form action={voidCommission}>
                      <input type="hidden" name="commissionId" value={c.id} />
                      <button className="text-xs text-red-600 hover:underline">Annuler (remboursement)</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
