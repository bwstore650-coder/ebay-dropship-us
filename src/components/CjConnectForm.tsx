"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Dict } from "@/lib/i18n";
import { errorMessage } from "@/lib/i18n/errors";

export default function CjConnectForm({ t, errors }: { t: Dict["settings"]; errors: Dict["errors"] }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const apiKey = new FormData(e.currentTarget).get("apiKey");
    const res = await fetch("/api/suppliers/cj", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey }) });
    const data = await res.json().catch(() => ({}));
    setMsg(res.ok ? t.cjSuccess : errorMessage(errors, data.error));
    setLoading(false);
    if (res.ok) router.refresh();
  }
  return (
    <form onSubmit={onSubmit} className="mt-3 flex flex-wrap gap-2">
      <input name="apiKey" required placeholder={t.cjPlaceholder} className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      <button disabled={loading} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{t.cjButton}</button>
      {msg && <p className="w-full text-sm text-slate-600">{msg}</p>}
    </form>
  );
}
