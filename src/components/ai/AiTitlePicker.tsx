"use client";
import { useState } from "react";
import { fmt, type Dict } from "@/lib/i18n";
import type { AiUsage } from "./useAiGenerate";

/** Titres proposés par l'IA : clic = utiliser ce titre ; bouton « Régénérer ». */
export function AiTitlePicker({
  t, titles, current, onPick, onRegenerate, busy, mode = "pick",
}: {
  t: Dict["listing"]["ai"];
  titles: string[];
  current?: string;
  onPick?: (title: string) => void;
  onRegenerate?: () => void;
  busy?: boolean;
  mode?: "pick" | "copy";
}) {
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <div className="mt-2 rounded-xl border border-brand-500/25 bg-brand-500/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-brand-200">✦ {t.titleIdeas}</p>
        {onRegenerate && (
          <button type="button" onClick={onRegenerate} disabled={busy} className="text-xs font-medium text-brand-300 hover:underline disabled:opacity-60">
            {busy ? t.writing : titles.length ? t.regenerate : t.generate}
          </button>
        )}
      </div>
      {titles.length === 0 && <p className="mt-1 text-xs text-subtle">{t.generateHint}</p>}
      <ul className="mt-2 space-y-1.5">
        {titles.map((title) => {
          const active = current === title;
          return (
            <li key={title} className="flex items-center gap-2">
              <span className={`min-w-0 flex-1 text-sm ${active ? "text-fg" : "text-fg-2"}`}>{title}</span>
              <span className="shrink-0 text-xs tabular-nums text-subtle">{title.length}/80</span>
              {mode === "pick" ? (
                <button type="button" disabled={active} onClick={() => onPick?.(title)} className="shrink-0 rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-medium text-fg hover:bg-brand-500/20 disabled:opacity-50">
                  {active ? t.inUse : t.use}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(title);
                    setCopied(title);
                    setTimeout(() => setCopied(null), 1500);
                  }}
                  className="shrink-0 rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-medium text-fg hover:bg-brand-500/20"
                >
                  {copied === title ? t.copied : t.copy}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Quota IA du mois. */
export function AiUsageLine({ t, usage }: { t: Dict["listing"]["ai"]; usage: AiUsage | null }) {
  if (!usage) return null;
  return (
    <span className="text-xs text-subtle">
      {usage.unlimited ? fmt(t.usageUnlimited, { used: usage.used }) : fmt(t.usage, { used: usage.used, limit: usage.limit.toLocaleString() })}
    </span>
  );
}
