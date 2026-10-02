"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { fmt, type Dict } from "@/lib/i18n";
import { errorMessage } from "@/lib/i18n/errors";
import { Icon } from "@/components/icons";

export interface MessageRow {
  id: string;
  buyer: string;
  itemTitle: string | null;
  subject: string | null;
  body: string;
  receivedAt: string;
  draft: string | null;
  draftError: string | null;
  order: { status: string; trackingNumber: string | null; carrier: string | null } | null;
}

/** Questions des acheteurs : réponse préparée par l'IA, relue et envoyée d'un clic par le vendeur. */
export default function MessagesClient({ t, errors, statusLabels, initial, localeTag, aiOn }: {
  t: Dict["messages"];
  errors: Dict["errors"];
  statusLabels: Record<string, string>;
  initial: MessageRow[];
  localeTag: string;
  aiOn: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [texts, setTexts] = useState<Record<string, string>>(() => Object.fromEntries(initial.map((m) => [m.id, m.draft ?? ""])));
  const [busy, setBusy] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});

  const err = (code: string) => fmt(errorMessage(errors, code), { detail: "" });
  const date = (iso: string) => new Intl.DateTimeFormat(localeTag, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

  async function act(id: string, action: "draft" | "send" | "dismiss") {
    setBusy(`${id}:${action}`);
    setErrs((e) => ({ ...e, [id]: "" }));
    const res = await fetch(`/api/messages/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action === "send" ? { action, body: texts[id] ?? "" } : { action }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(null);
    if (!res?.ok) return setErrs((e) => ({ ...e, [id]: err(data.error ?? "UPSTREAM") }));
    if (action === "draft") setTexts((x) => ({ ...x, [id]: data.draft ?? "" }));
    else {
      setRows((r) => r.filter((m) => m.id !== id));
      setNotice(action === "send" ? t.sent : t.dismissed);
      router.refresh();
    }
  }

  async function sync() {
    setSyncing(true);
    setNotice(null);
    const res = await fetch("/api/messages/sync", { method: "POST" }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setSyncing(false);
    if (!res?.ok) return setNotice(err(data.error ?? "UPSTREAM"));
    setNotice(fmt(t.synced, { n: data.added ?? 0 }));
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">{fmt(t.count, { n: rows.length })}</p>
        <button type="button" onClick={sync} disabled={syncing} className="btn-secondary px-3 py-1.5 text-sm"><Icon name="refresh" className="h-4 w-4" />{syncing ? t.syncing : t.sync}</button>
      </div>
      {notice && <p className="text-sm text-emerald-300">{notice}</p>}

      {rows.length === 0 ? (
        <div className="card grid place-items-center py-12 text-center">
          <Icon name="message" className="h-6 w-6 text-subtle" />
          <p className="mt-2 max-w-sm text-sm text-muted">{t.empty}</p>
        </div>
      ) : (
        rows.map((m) => (
          <article key={m.id} className="card space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-semibold text-fg">{m.buyer}</p>
              <p className="text-xs text-subtle">{date(m.receivedAt)}</p>
            </div>
            {m.itemTitle && <p className="truncate text-xs text-muted">{m.itemTitle}</p>}
            <blockquote className="whitespace-pre-wrap rounded-lg border border-line bg-surface-2/60 p-3 text-sm text-fg-2">{m.body}</blockquote>
            <p className="text-xs text-muted">
              {m.order
                ? <>{t.order} : <span className="text-fg-2">{statusLabels[m.order.status] ?? m.order.status}</span>{m.order.trackingNumber && <> · {t.tracking} <span className="font-mono text-fg-2">{m.order.trackingNumber}</span>{m.order.carrier ? ` (${m.order.carrier})` : ""}</>}</>
                : t.noOrder}
            </p>
            <label className="block text-xs font-medium text-muted">
              {t.reply}
              <textarea value={texts[m.id] ?? ""} onChange={(e) => setTexts((x) => ({ ...x, [m.id]: e.target.value.slice(0, 2000) }))} rows={5}
                placeholder={aiOn ? t.replyPlaceholderAi : t.replyPlaceholder} className="input mt-1 w-full py-2 text-sm" />
            </label>
            {m.draftError === "AI_LIMIT" && !texts[m.id] && <p className="text-xs text-amber-300">{err("AI_LIMIT")}</p>}
            {errs[m.id] && <p className="text-xs text-red-400">{errs[m.id]}</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={!!busy || !(texts[m.id] ?? "").trim()} onClick={() => act(m.id, "send")} className="btn-primary px-4 py-1.5 text-sm">
                {busy === `${m.id}:send` ? t.sending : t.send}
              </button>
              {aiOn && (
                <button type="button" disabled={!!busy} onClick={() => act(m.id, "draft")} className="btn-secondary px-3 py-1.5 text-sm">
                  <Icon name="zap" className="h-3.5 w-3.5" />{busy === `${m.id}:draft` ? t.drafting : texts[m.id] ? t.redraft : t.draft}
                </button>
              )}
              <button type="button" disabled={!!busy} onClick={() => act(m.id, "dismiss")} className="px-3 py-1.5 text-sm text-muted hover:text-fg">{t.dismiss}</button>
            </div>
          </article>
        ))
      )}
      <p className="text-xs text-subtle">{t.note}</p>
    </div>
  );
}
