"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Dict } from "@/lib/i18n";
import { fmt } from "@/lib/i18n";

interface Row { id: string; label: string | null; createdAt: string; lastUsedAt: string | null }

/** Réglages : navigateurs où l'extension est connectée, avec déconnexion. */
export default function ExtensionTokens({ t, locale }: { t: Dict["extension"]; locale: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const load = () => fetch("/api/ext/tokens").then((r) => r.json()).then((d: { tokens?: Row[] }) => setRows(d.tokens ?? []));
  useEffect(() => {
    load();
  }, []);
  async function remove(id: string) {
    await fetch(`/api/ext/tokens?${new URLSearchParams({ id })}`, { method: "DELETE" });
    load();
  }
  const date = (s: string) => new Date(s).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  return (
    <div className="mt-3 space-y-3">
      {rows === null ? null : rows.length === 0 ? (
        <p className="text-sm text-muted">{t.none}</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className="min-w-0">
                <span className="block truncate text-fg">{r.label ?? "—"}</span>
                <span className="text-xs text-subtle">{r.lastUsedAt ? fmt(t.lastUsed, { date: date(r.lastUsedAt) }) : t.never}</span>
              </span>
              <button onClick={() => remove(r.id)} className="btn-secondary shrink-0 px-3 py-1.5 text-xs">{t.disconnect}</button>
            </li>
          ))}
        </ul>
      )}
      <Link href="/extension/connect" className="inline-block text-sm font-medium text-brand-300 hover:text-brand-200">{t.connectLink}</Link>
    </div>
  );
}
