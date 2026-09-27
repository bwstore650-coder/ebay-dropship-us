import { requireUser } from "@/lib/auth";
import { dailyListingLimit } from "@/lib/compliance";
import { maxEbayAccounts } from "@/lib/plans";
import CjConnectForm from "@/components/CjConnectForm";

export default async function Settings({ searchParams }: { searchParams: Promise<{ ebay?: string }> }) {
  const user = await requireUser();
  const { ebay } = await searchParams;
  const cj = user.supplierAccounts.find((a: { supplier: string }) => a.supplier === "CJ");
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Réglages</h1>
      {ebay === "connected" && <p className="rounded-lg bg-green-50 p-3 text-green-700">Compte eBay connecté.</p>}
      {ebay === "error" && <p className="rounded-lg bg-red-50 p-3 text-red-700">La connexion eBay a échoué, réessaie.</p>}
      {ebay === "limit" && <p className="rounded-lg bg-amber-50 p-3 text-amber-700">Ta formule ne permet pas d&apos;ajouter un autre compte eBay. Passe à Business ou Agence.</p>}

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="font-semibold">Comptes eBay ({user.ebayAccounts.length}/{maxEbayAccounts(user.plan)})</h2>
        <p className="mt-1 text-sm text-slate-600">
          Connexion via l&apos;API officielle d&apos;eBay. Limite actuelle : {dailyListingLimit(user.ebayAccountOpenedAt)} annonces par jour et par compte.
        </p>
        <ul className="mt-3 space-y-2">
          {user.ebayAccounts.map((a: { id: string; label: string | null; ebayUserId: string | null }, i: number) => (
            <li key={a.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <span>{a.label ?? a.ebayUserId ?? `Compte eBay ${i + 1}`}</span>
              <a href={`/api/ebay/connect?account=${a.id}`} className="text-blue-600">Reconnecter</a>
            </li>
          ))}
        </ul>
        {user.ebayAccounts.length < maxEbayAccounts(user.plan) && (
          <a href="/api/ebay/connect" className="mt-3 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">
            {user.ebayAccounts.length ? "Ajouter un compte eBay" : "Connecter eBay"}
          </a>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="font-semibold">Fournisseur CJDropshipping</h2>
        <p className="mt-1 text-sm text-slate-600">{cj ? "Connecté." : "Colle ta clé API CJ pour comparer ses prix et commander automatiquement."}</p>
        <CjConnectForm />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="font-semibold">Fournisseur AliExpress</h2>
        <p className="mt-1 text-sm text-slate-600">Bientôt disponible : en attente de la validation de l&apos;accès Dropshipping sur AliExpress Open Platform.</p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="font-semibold">Marge minimum</h2>
        <p className="mt-1 text-sm text-slate-600">Seuls les produits à {user.minMarginPct} % de marge ou plus sont proposés.</p>
      </section>
    </div>
  );
}
