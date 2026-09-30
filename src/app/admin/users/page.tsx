import { db } from "@/lib/db";
import { isTrialing } from "@/lib/admin";
import { Card } from "@/components/admin/Kpi";

export const dynamic = "force-dynamic";

const PAGE = 50;

export default async function AdminUsers({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const { q = "", page = "1" } = await searchParams;
  const p = Math.max(1, Number(page) || 1);
  const where = q ? { email: { contains: q.trim().toLowerCase() } } : {};
  const [users, count] = await Promise.all([
    db.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (p - 1) * PAGE,
      take: PAGE,
      select: {
        id: true, email: true, plan: true, billingInterval: true, trialEndsAt: true, createdAt: true,
        referredBy: { select: { email: true } },
        _count: { select: { ebayAccounts: true, listings: true, referrals: true } },
      },
    }),
    db.user.count({ where }),
  ]);
  const now = new Date();
  const pages = Math.max(1, Math.ceil(count / PAGE));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg sm:text-[28px]">Clients</h1>
          <p className="text-sm text-muted">{count} comptes</p>
        </div>
        <form className="flex gap-2">
          <input name="q" defaultValue={q} placeholder="Rechercher un email" className="rounded-lg border border-line-strong px-3 py-2 text-sm" />
          <button className="btn-primary px-4 py-2 text-sm">Chercher</button>
        </form>
      </div>
      <Card title="Derniers inscrits">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-muted">
              <tr>
                <th className="pb-2">Email</th><th className="pb-2">Formule</th><th className="pb-2">Statut</th>
                <th className="pb-2 text-right">Comptes eBay</th><th className="pb-2 text-right">Annonces</th>
                <th className="pb-2 text-right">Filleuls</th><th className="pb-2">Parrain</th><th className="pb-2">Inscrit le</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-line">
                  <td className="py-2 font-medium">{u.email}</td>
                  <td className="py-2">{u.plan}{u.billingInterval === "year" ? " (annuel)" : ""}</td>
                  <td className="py-2">
                    {u.plan === "NONE" ? <span className="text-subtle">Sans formule</span>
                      : isTrialing(u, now) ? <span className="rounded bg-amber-500/15 px-2 py-0.5 text-amber-300">Essai</span>
                      : <span className="rounded bg-green-500/15 px-2 py-0.5 text-green-300">Payant</span>}
                  </td>
                  <td className="py-2 text-right">{u._count.ebayAccounts}</td>
                  <td className="py-2 text-right">{u._count.listings}</td>
                  <td className="py-2 text-right">{u._count.referrals}</td>
                  <td className="py-2 text-muted">{u.referredBy?.email ?? "—"}</td>
                  <td className="py-2 text-muted">{u.createdAt.toLocaleDateString("fr-FR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex justify-between text-sm">
          {p > 1 ? <a className="text-brand-400" href={`?q=${encodeURIComponent(q)}&page=${p - 1}`}>← Précédent</a> : <span />}
          <span className="text-muted">Page {p} / {pages}</span>
          {p < pages ? <a className="text-brand-400" href={`?q=${encodeURIComponent(q)}&page=${p + 1}`}>Suivant →</a> : <span />}
        </div>
      </Card>
    </div>
  );
}
