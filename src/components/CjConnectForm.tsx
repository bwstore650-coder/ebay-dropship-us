"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CjConnectForm() {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const apiKey = new FormData(e.currentTarget).get("apiKey");
    const res = await fetch("/api/suppliers/cj", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey }) });
    const data = await res.json();
    setMsg(res.ok ? "CJ connecté." : data.error);
    if (res.ok) router.refresh();
  }
  return (
    <form onSubmit={onSubmit} className="mt-3 flex flex-wrap gap-2">
      <input name="apiKey" required placeholder="Clé API CJ (Apps > API)" className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Connecter CJ</button>
      {msg && <p className="w-full text-sm text-slate-600">{msg}</p>}
    </form>
  );
}
