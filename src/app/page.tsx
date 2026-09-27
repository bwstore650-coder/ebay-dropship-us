import Link from "next/link";
import { PLANS } from "@/lib/plans";

export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-16">
      <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">eBay US · dropshipping conforme</p>
      <h1 className="mt-3 text-4xl font-bold sm:text-5xl">Des produits qui se vendent vraiment, avec 30 % de marge minimum.</h1>
      <p className="mt-4 max-w-2xl text-lg text-slate-600">
        L&apos;outil compare le prix du marché eBay au coût livré chez AliExpress et CJ, ne te montre que les produits rentables,
        les met en vente et passe les commandes pour toi. Aucun fournisseur interdit par eBay, jamais.
      </p>
      <div className="mt-8 flex gap-3">
        <Link href="/register" className="rounded-lg bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700">Essai gratuit 7 jours</Link>
        <Link href="/login" className="rounded-lg border border-slate-300 px-5 py-3 font-semibold hover:bg-white">Se connecter</Link>
        <Link href="/ebay-profit-calculator" className="rounded-lg px-5 py-3 font-semibold text-blue-600 hover:underline">Calculateur de profit gratuit</Link>
      </div>
      <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PLANS.map((p) => (
          <div key={p.id} className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold">{p.name}</h2>
            <p className="mt-2 text-3xl font-bold">{p.priceUsd} $<span className="text-base font-normal text-slate-500">/mois</span></p>
            <ul className="mt-4 space-y-1 text-sm text-slate-600">
              <li>{p.listingsPerMonth ?? "Illimité"} annonces / mois</li>
              <li>{p.autoOrdersPerMonth ?? "Illimité"} commandes auto / mois</li>
              <li>{p.maxEbayAccounts} compte{p.maxEbayAccounts > 1 ? "s" : ""} eBay</li>
              <li>Filtre de marge + protection du compte</li>
            </ul>
          </div>
        ))}
      </div>
    </main>
  );
}
