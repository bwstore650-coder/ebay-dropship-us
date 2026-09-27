"use client";
import { useMemo, useState } from "react";
import { computeMargin, priceForTargetMargin } from "@/lib/margin";
import { MARKETPLACES, type MarketplaceId } from "@/lib/marketplaces";
import type { Dict } from "@/lib/i18n";
import { errorMessage } from "@/lib/i18n/errors";

function num(v: string): number {
  const n = parseFloat(v.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
const pct = (rate: number) => String(+(rate * 100).toFixed(2));

export default function ProfitCalculator({
  t, markets, errors, marketIds, defaultMarket,
}: {
  t: Dict["calculator"];
  markets: Dict["markets"];
  errors: Dict["errors"];
  marketIds: MarketplaceId[];
  defaultMarket: MarketplaceId;
}) {
  const [site, setSite] = useState<MarketplaceId>(defaultMarket);
  const [sale, setSale] = useState("30");
  const [shipCharged, setShipCharged] = useState("0");
  const [cost, setCost] = useState("12");
  const [supplierShip, setSupplierShip] = useState("0");
  const [tax, setTax] = useState("0");
  const [promo, setPromo] = useState("0");
  const [fvf, setFvf] = useState(pct(MARKETPLACES[defaultMarket].fvfRate));

  const market = MARKETPLACES[site];
  const s = market.symbol;

  const r = useMemo(() => {
    const opts = { market, fvfRate: num(fvf) / 100, promotedRate: num(promo) / 100 };
    const saleTotal = num(sale) + num(shipCharged);
    const m = computeMargin({ ...opts, saleTotal, supplierCost: num(cost), supplierShipping: num(supplierShip), supplierTaxRate: num(tax) / 100 });
    let breakEven: number | null = null;
    let for30: number | null = null;
    try { breakEven = priceForTargetMargin(m.landedCost, 0, opts); } catch { /* frais ≥ 100 % */ }
    try { for30 = priceForTargetMargin(m.landedCost, 30, opts); } catch { /* impossible */ }
    return { ...m, breakEven, for30 };
  }, [market, sale, shipCharged, cost, supplierShip, tax, promo, fvf]);

  const good = r.marginPct >= 30;
  const money = (v: number) => `${v.toFixed(2)} ${s}`;

  return (
    <div className="mt-8 space-y-8">
      <div className="grid gap-4 rounded-xl border border-slate-200 bg-white p-6 sm:grid-cols-2">
        <label className="block text-sm sm:col-span-2">
          <span className="text-slate-600">{t.site}</span>
          <select
            value={site}
            onChange={(e) => {
              const id = e.target.value as MarketplaceId;
              setSite(id);
              setFvf(pct(MARKETPLACES[id].fvfRate));
            }}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          >
            {marketIds.map((id) => <option key={id} value={id}>{markets[id]}</option>)}
          </select>
        </label>
        <Field label={`${t.itemPrice} (${s})`} value={sale} onChange={setSale} />
        <Field label={`${t.shippingCharged} (${s})`} value={shipCharged} onChange={setShipCharged} />
        <Field label={`${t.supplierCost} (${s})`} value={cost} onChange={setCost} />
        <Field label={`${t.supplierShipping} (${s})`} value={supplierShip} onChange={setSupplierShip} />
        <Field label={t.salesTax} value={tax} onChange={setTax} />
        <Field label={t.promoted} value={promo} onChange={setPromo} />
        <Field label={t.fvf} value={fvf} onChange={setFvf} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label={t.profit} value={money(r.profit)} tone={r.profit > 0 ? (good ? "good" : "warn") : "bad"} />
        <Stat label={t.margin} value={`${r.marginPct} %`} tone={good ? "good" : r.profit > 0 ? "warn" : "bad"} />
        <Stat label={t.fees} value={money(r.fees)} />
        <Stat label={t.totalCost} value={money(r.landedCost)} />
        <Stat label={t.breakEven} value={r.breakEven !== null ? money(r.breakEven) : "—"} />
        <Stat label={t.for30} value={r.for30 !== null ? money(r.for30) : "—"} />
      </div>

      <LeadForm t={t} errors={errors} />
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-sm">
      <span className="text-slate-600">{label}</span>
      <input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
    </label>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "good" ? "text-green-600" : tone === "warn" ? "text-amber-600" : tone === "bad" ? "text-red-600" : "text-slate-900";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function LeadForm({ t, errors }: { t: Dict["calculator"]; errors: Dict["errors"] }) {
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("sending");
    const email = new FormData(e.currentTarget).get("email");
    const res = await fetch("/api/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, source: "profit-calculator" }) });
    if (res.ok) setState("done");
    else { setState("error"); setMsg(errorMessage(errors, (await res.json().catch(() => ({}))).error)); }
  }
  if (state === "done") return <p className="rounded-xl bg-green-50 p-6 text-green-700">{t.leadDone}</p>;
  return (
    <form onSubmit={submit} className="rounded-xl border border-blue-200 bg-blue-50 p-6">
      <h2 className="text-lg font-semibold">{t.leadTitle}</h2>
      <p className="mt-1 text-sm text-slate-600">{t.leadText}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <input name="email" type="email" required placeholder={t.leadPlaceholder} className="flex-1 rounded-lg border border-slate-300 px-3 py-2" />
        <button disabled={state === "sending"} className="rounded-lg bg-blue-600 px-5 py-2 font-semibold text-white disabled:opacity-60">
          {state === "sending" ? "…" : t.leadButton}
        </button>
      </div>
      {state === "error" && <p className="mt-2 text-sm text-red-600">{msg}</p>}
    </form>
  );
}
