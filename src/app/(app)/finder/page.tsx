"use client";
import { useState } from "react";

const MARKETS = [
  { id: "EBAY_US", label: "États-Unis" },
  { id: "EBAY_CA", label: "Canada" },
  { id: "EBAY_GB", label: "Royaume-Uni" },
  { id: "EBAY_AU", label: "Australie" },
];

interface Result {
  symbol: string;
  currency: string;
  feesVerified: boolean;
  verdict: "RENTABLE" | "TROP_FAIBLE" | "PAS_DE_FOURNISSEUR" | "PAS_DE_PRIX";
  keyword: string;
  marketPrice: number | null;
  ebayListingsCount: number;
  offersChecked: number;
  unitsSold: number;
  priceSource: "SOLD_WEIGHTED" | "ACTIVE_LISTINGS";
  best: { supplier: string; title: string; price: number; shipping: number; deliveryDaysMax: number; stockUs: number } | null;
  margin: { landedCost: number; fees: number; profit: number; marginPct: number } | null;
  minPriceForTarget: number | null;
  error?: string;
}

const LABEL: Record<Result["verdict"], string> = {
  RENTABLE: "Rentable",
  TROP_FAIBLE: "Marge trop faible",
  PAS_DE_FOURNISSEUR: "Aucun fournisseur US valable",
  PAS_DE_PRIX: "Pas assez de données eBay",
};

export default function Finder() {
  const [r, setR] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);

  async function search(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/finder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: form.get("keyword"), marketId: form.get("marketId") }),
    });
    setR(await res.json());
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Chercheur de produits</h1>
      <form onSubmit={search} className="flex gap-2">
        <input name="keyword" required placeholder="ex. electric can opener" className="flex-1 rounded-lg border border-slate-300 px-3 py-2" />
        <select name="marketId" defaultValue="EBAY_US" className="rounded-lg border border-slate-300 px-3 py-2">
          {MARKETS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <button disabled={loading} className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-60">{loading ? "Analyse…" : "Analyser"}</button>
      </form>
      {r?.error && <p className="text-red-600">{r.error}</p>}
      {r && !r.error && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <p className={`text-lg font-semibold ${r.verdict === "RENTABLE" ? "text-green-600" : "text-amber-600"}`}>{LABEL[r.verdict]}</p>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2 text-sm">
            <Row k={r.priceSource === "SOLD_WEIGHTED" ? "Prix du marché (pondéré par les ventes)" : "Prix du marché (annonces actives)"} v={r.marketPrice !== null ? `${r.marketPrice.toFixed(2)} ${r.symbol}` : "—"} />
            <Row k="Annonces eBay trouvées" v={r.ebayListingsCount} />
            <Row k="Unités vendues (20 premières annonces, estimation eBay)" v={r.unitsSold} />
            <Row k="Offres fournisseurs comparées" v={r.offersChecked} />
            {r.best && <Row k="Meilleur fournisseur" v={`${r.best.supplier} — ${r.best.title}`} />}
            {r.best && <Row k="Livraison" v={`≤ ${r.best.deliveryDaysMax} jours · stock US ${r.best.stockUs}`} />}
            {r.margin && <Row k="Coût livré" v={`${r.margin.landedCost.toFixed(2)} ${r.symbol}`} />}
            {r.margin && <Row k="Frais eBay" v={`${r.margin.fees.toFixed(2)} ${r.symbol}`} />}
            {r.margin && <Row k="Profit estimé" v={`${r.margin.profit.toFixed(2)} ${r.symbol} (${r.margin.marginPct} %)`} />}
            {r.minPriceForTarget && <Row k="Prix minimum pour ta marge cible" v={`${r.minPriceForTarget.toFixed(2)} ${r.symbol}`} />}
          </dl>
          {!r.feesVerified && <p className="mt-4 rounded-lg bg-amber-50 p-2 text-xs text-amber-700">Frais eBay de ce pays à confirmer : vérifie le taux de ta catégorie avant de lister.</p>}
          <p className="mt-4 text-xs text-slate-500">Coûts fournisseurs convertis depuis l&apos;USD (taux BCE + 2 % de marge de sécurité). Source : API officielle eBay. Le prix est pondéré par les ventes estimées de chaque annonce ; sans ventes, c&apos;est la médiane des annonces actives neuves aux US.</p>
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string | number }) {
  return (<div><dt className="text-slate-500">{k}</dt><dd className="font-medium">{v}</dd></div>);
}
