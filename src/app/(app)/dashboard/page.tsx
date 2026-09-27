import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

export default async function Dashboard() {
  const user = await requireUser();
  const [listings, orders] = await Promise.all([
    db.listing.count({ where: { userId: user.id, status: "ACTIVE" } }),
    db.order.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const steps = [
    { done: user.plan !== "NONE", label: "Choisir une formule", href: "/billing" },
    { done: user.ebayAccounts.length > 0, label: "Connecter ton compte eBay", href: "/settings" },
    { done: user.supplierAccounts.length > 0, label: "Connecter un fournisseur (CJ ou AliExpress)", href: "/settings" },
    { done: listings > 0, label: "Mettre en vente ton premier produit rentable", href: "/finder" },
  ];
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Tableau de bord</h1>
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="font-semibold">Démarrage</h2>
        <ul className="mt-3 space-y-2">
          {steps.map((s) => (
            <li key={s.label} className="flex items-center gap-2">
              <span className={s.done ? "text-green-600" : "text-slate-400"}>{s.done ? "✓" : "○"}</span>
              {s.done ? s.label : <Link className="text-blue-600" href={s.href}>{s.label}</Link>}
            </li>
          ))}
        </ul>
      </section>
      <section className="grid gap-4 sm:grid-cols-3">
        <Stat label="Annonces actives" value={listings} />
        <Stat label="Commandes (10 dernières)" value={orders.length} />
        <Stat label="Profit sur ces commandes (USD)" value={`${orders.filter((o: { currency: string }) => o.currency === "USD").reduce((s: number, o: { saleTotal: number; supplierCost: number | null }) => s + (o.saleTotal - (o.supplierCost ?? 0)), 0).toFixed(2)} $`} />
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}
