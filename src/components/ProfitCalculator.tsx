"use client";
import { useMemo, useState } from "react";
import { computeMargin, EBAY_FVF_RATE, priceForTargetMargin } from "@/lib/margin";

function num(v: string): number {
  const n = parseFloat(v.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export default function ProfitCalculator() {
  const [sale, setSale] = useState("30");
  const [shipCharged, setShipCharged] = useState("0");
  const [cost, setCost] = useState("12");
  const [supplierShip, setSupplierShip] = useState("0");
  const [tax, setTax] = useState("0");
  const [promo, setPromo] = useState("0");
  const [fvf, setFvf] = useState(String(+(EBAY_FVF_RATE * 100).toFixed(2)));

  const r = useMemo(() => {
    const opts = { fvfRate: num(fvf) / 100, promotedRate: num(promo) / 100 };
    const saleTotal = num(sale) + num(shipCharged);
    const m = computeMargin({ ...opts, saleTotal, supplierCost: num(cost), supplierShipping: num(supplierShip), supplierTaxRate: num(tax) / 100 });
    let breakEven: number | null = null;
    let for30: number | null = null;
    try { breakEven = priceForTargetMargin(m.landedCost, 0, opts); } catch { /* frais ≥ 100 % */ }
    try { for30 = priceForTargetMargin(m.landedCost, 30, opts); } catch { /* impossible */ }
    return { ...m, breakEven, for30 };
  }, [sale, shipCharged, cost, supplierShip, tax, promo, fvf]);

  const good = r.marginPct >= 30;
  return (
    <div className="mt-8 space-y-8">
      <div className="grid gap-4 rounded-xl border border-slate-200 bg-white p-6 sm:grid-cols-2">
        <Field label="Item price ($)" value={sale} onChange={setSale} />
        <Field label="Shipping you charge the buyer ($)" value={shipCharged} onChange={setShipCharged} />
        <Field label="Supplier item cost ($)" value={cost} onChange={setCost} />
        <Field label="Supplier shipping ($)" value={supplierShip} onChange={setSupplierShip} />
        <Field label="Sales tax your supplier charges (%)" value={tax} onChange={setTax} />
        <Field label="Promoted Listings ad rate (%)" value={promo} onChange={setPromo} />
        <Field label="eBay final value fee (%)" value={fvf} onChange={setFvf} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Profit" value={`$${r.profit.toFixed(2)}`} tone={r.profit > 0 ? (good ? "good" : "warn") : "bad"} />
        <Stat label="Margin" value={`${r.marginPct}%`} tone={good ? "good" : r.profit > 0 ? "warn" : "bad"} />
        <Stat label="eBay fees" value={`$${r.fees.toFixed(2)}`} />
        <Stat label="Your total cost" value={`$${r.landedCost.toFixed(2)}`} />
        <Stat label="Break-even price" value={r.breakEven !== null ? `$${r.breakEven.toFixed(2)}` : "—"} />
        <Stat label="Price for a 30% margin" value={r.for30 !== null ? `$${r.for30.toFixed(2)}` : "—"} />
      </div>

      <LeadForm />
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

function LeadForm() {
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("sending");
    const email = new FormData(e.currentTarget).get("email");
    const res = await fetch("/api/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, source: "profit-calculator" }) });
    if (res.ok) setState("done");
    else { setState("error"); setMsg((await res.json()).error ?? "Something went wrong."); }
  }
  if (state === "done") return <p className="rounded-xl bg-green-50 p-6 text-green-700">You&apos;re in. The next list of winning products will land in your inbox.</p>;
  return (
    <form onSubmit={submit} className="rounded-xl border border-blue-200 bg-blue-50 p-6">
      <h2 className="text-lg font-semibold">Get 10 profitable eBay products every week — free</h2>
      <p className="mt-1 text-sm text-slate-600">Checked against real eBay demand, 30%+ margin, US suppliers only, no Amazon or Walmart.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <input name="email" type="email" required placeholder="you@email.com" className="flex-1 rounded-lg border border-slate-300 px-3 py-2" />
        <button disabled={state === "sending"} className="rounded-lg bg-blue-600 px-5 py-2 font-semibold text-white disabled:opacity-60">
          {state === "sending" ? "…" : "Send me the list"}
        </button>
      </div>
      {state === "error" && <p className="mt-2 text-sm text-red-600">{msg}</p>}
    </form>
  );
}
