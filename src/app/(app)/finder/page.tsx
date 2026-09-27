"use client";
import { useState } from "react";

interface Result {
  verdict: "RENTABLE" | "TROP_FAIBLE" | "PAS_DE_FOURNISSEUR" | "PAS_DE_PRIX";
  keyword: string;
  marketPrice: number | null;
  ebayListingsCount: number;
  offersChecked: number;
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
    const keyword = new FormData(e.currentTarget).get("keyword");
    const res = await fetch("/api/finder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keyword }) });
    setR(await res.json());
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Chercheur de produits</h1>
      <form onSubmit={search} className="flex gap-2">
        <input name="keyword" required placeholder="ex. electric can opener" className="flex-1 rounded-lg border border-slate-300 px-3 py-2" />
        <button disabled={loading} className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-60">{loading ? "Analyse…" : "Analyser"}</button>
      </form>
      {r?.error && <p className="text-red-600">{r.error}</p>}
      {r && !r.error && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <p className={`text-lg font-semibold ${r.verdict === "RENTABLE" ? "text-green-600" : "text-amber-600"}`}>{LABEL[r.verdict]}</p>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2 text-sm">
            <Row k="Prix du marché eBay (médiane)" v={r.marketPrice !== null ? `${r.marketPrice.toFixed(2)} $` : "—"} />
            <Row k="Annonces eBay trouvées" v={r.ebayListingsCount} />
            <Row k="Offres fournisseurs comparées" v={r.offersChecked} />
            {r.best && <Row k="Meilleur fournisseur" v={`${r.best.supplier} — ${r.best.title}`} />}
            {r.best && <Row k="Livraison" v={`≤ ${r.best.deliveryDaysMax} jours · stock US ${r.best.stockUs}`} />}
            {r.margin && <Row k="Coût livré" v={`${r.margin.landedCost.toFixed(2)} $`} />}
            {r.margin && <Row k="Frais eBay" v={`${r.margin.fees.toFixed(2)} $`} />}
            {r.margin && <Row k="Profit estimé" v={`${r.margin.profit.toFixed(2)} $ (${r.margin.marginPct} %)`} />}
            {r.minPriceForTarget && <Row k="Prix minimum pour ta marge cible" v={`${r.minPriceForTarget.toFixed(2)} $`} />}
          </dl>
          <p className="mt-4 text-xs text-slate-500">Prix du marché calculé sur les annonces actives neuves aux US (en attendant la source des ventes réelles).</p>
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string | number }) {
  return (<div><dt className="text-slate-500">{k}</dt><dd className="font-medium">{v}</dd></div>);
}
