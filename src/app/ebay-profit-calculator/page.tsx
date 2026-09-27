import type { Metadata } from "next";
import ProfitCalculator from "@/components/ProfitCalculator";

export const metadata: Metadata = {
  title: "Free eBay Profit Calculator (2026 fees) — Dropshipping margin & break-even",
  description:
    "Calculate your real eBay profit after the 13.6% final value fee, the per-order fee, sales tax and promoted listings. See your break-even price and the price you need for a 30% margin.",
};

export default function Page() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">Free tool</p>
      <h1 className="mt-2 text-3xl font-bold sm:text-4xl">eBay Profit Calculator</h1>
      <p className="mt-3 text-slate-600">
        Enter your selling price and your supplier cost. You get your real profit after eBay fees, your break-even price and
        the price you need for a 30% margin. Uses the standard eBay US fee: 13.6% of the total sale + $0.40 per order
        ($0.30 for orders of $10 or less). Some categories use a different rate — you can change it below.
      </p>
      <ProfitCalculator />
    </main>
  );
}
