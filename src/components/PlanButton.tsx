"use client";
import { useState } from "react";

export default function PlanButton({ plan, label }: { plan: string; label: string }) {
  const [loading, setLoading] = useState(false);
  async function go() {
    setLoading(true);
    const res = await fetch("/api/stripe/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan }) });
    const data = await res.json();
    if (data.url) window.location.href = data.url;
    else { alert(data.error ?? "Erreur"); setLoading(false); }
  }
  return (
    <button onClick={go} disabled={loading} className="mt-4 w-full rounded-lg bg-blue-600 py-2 font-semibold text-white disabled:opacity-60">
      {loading ? "…" : label}
    </button>
  );
}
