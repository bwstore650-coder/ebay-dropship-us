"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { fmt, type Dict } from "@/lib/i18n";
import { errorMessage } from "@/lib/i18n/errors";
import { Icon } from "@/components/icons";

type Msg = { role: "user" | "assistant"; content: string };
type Pending = { tool: "start_product_search" | "end_listing" | "check_listings_now"; args: Record<string, unknown> };
type Item = Msg & { pending?: Pending; done?: { ok: boolean; text: string; link?: string } };

/** Chat de l'assistant Sellvela (bouton flottant). Les actions proposées par l'IA attendent la confirmation du vendeur. */
export default function AssistantChat({ t, errors, categoryNames }: { t: Dict["assistant"]; errors: Dict["errors"]; categoryNames: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [acting, setActing] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [items, busy, open]);

  const err = (code: string) => fmt(errorMessage(errors, code), { detail: "" });

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const next: Item[] = [...items.map((i) => ({ ...i, pending: undefined })), { role: "user", content: q }];
    setItems(next);
    setInput("");
    setBusy(true);
    const res = await fetch("/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })) }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) {
      setItems((cur) => [...cur, { role: "assistant", content: err(data.error ?? "UPSTREAM") }]);
      return;
    }
    const pending = data.pending ? ({ tool: data.pending.tool, args: data.pending.args } as Pending) : undefined;
    setItems((cur) => [...cur, { role: "assistant", content: data.reply || (pending ? t.confirmPrompt : t.empty), pending }]);
  }

  async function confirm(index: number, p: Pending) {
    setActing(true);
    const res = await fetch("/api/assistant/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setActing(false);
    const done = data.ok
      ? { ok: true, text: data.code === "SNIPER_STARTED" ? t.doneSniper : data.code === "LISTING_ENDED" ? t.doneEnded : t.doneChecked, link: data.code === "SNIPER_STARTED" ? "/sniper" : data.code === "LISTING_ENDED" || data.code === "CHECKED" ? "/listings" : undefined }
      : { ok: false, text: err(data.code ?? data.error ?? "UPSTREAM") };
    setItems((cur) => cur.map((it, i) => (i === index ? { ...it, pending: undefined, done } : it)));
  }

  const cancel = (index: number) => setItems((cur) => cur.map((it, i) => (i === index ? { ...it, pending: undefined, done: { ok: false, text: t.cancelled } } : it)));

  const describe = (p: Pending) => {
    if (p.tool === "start_product_search") {
      const cats = Array.isArray(p.args.categories) ? (p.args.categories as string[]).map((c) => categoryNames[c] ?? c).join(", ") : "";
      const kws = Array.isArray(p.args.keywords) ? (p.args.keywords as string[]).join(", ") : "";
      return fmt(p.args.autoList ? t.actSniperList : t.actSniper, { n: Number(p.args.target) || 0, what: kws || cats || t.allCategories });
    }
    if (p.tool === "end_listing") return t.actEnd;
    return t.actCheck;
  };

  return (
    <>
      {!open && (
        <button type="button" onClick={() => setOpen(true)} aria-label={t.open}
          className="fixed right-4 bottom-4 z-40 flex items-center gap-2 rounded-full bg-gradient-to-r from-brand-500 to-fuchsia-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/30 hover:brightness-110">
          <Icon name="message" className="h-4 w-4" />{t.button}
        </button>
      )}
      {open && (
        <div role="dialog" aria-label={t.title}
          className="fixed inset-x-2 bottom-2 z-50 flex max-h-[85vh] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[400px]">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 font-semibold text-fg"><Icon name="zap" className="h-4 w-4 text-brand-300" />{t.title}</p>
              <p className="truncate text-xs text-muted">{t.subtitle}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {items.length > 0 && <button type="button" onClick={() => setItems([])} className="rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-fg">{t.clear}</button>}
              <button type="button" onClick={() => setOpen(false)} aria-label={t.close} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg"><Icon name="close" className="h-4 w-4" /></button>
            </div>
          </div>

          <div className="min-h-[240px] flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
            {items.length === 0 && (
              <div className="space-y-3">
                <p className="text-muted">{t.intro}</p>
                <div className="flex flex-col gap-1.5">
                  {[t.s1, t.s2, t.s3, t.s4].map((s) => (
                    <button key={s} type="button" onClick={() => send(s)} className="rounded-lg border border-line bg-surface-2/60 px-3 py-2 text-left text-xs text-fg-2 hover:border-brand-500/50 hover:text-fg">{s}</button>
                  ))}
                </div>
              </div>
            )}
            {items.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
                <div className={`max-w-[90%] whitespace-pre-wrap rounded-2xl px-3 py-2 ${m.role === "user" ? "bg-brand-500/20 text-fg" : "bg-surface-2 text-fg-2"}`}>
                  {m.content}
                  {m.pending && (
                    <div className="mt-2 space-y-2 rounded-xl border border-brand-500/40 bg-brand-500/10 p-2.5">
                      <p className="text-xs font-semibold text-fg">{describe(m.pending)}</p>
                      <div className="flex gap-2">
                        <button type="button" disabled={acting} onClick={() => confirm(i, m.pending!)} className="btn-primary px-3 py-1 text-xs">{acting ? t.working : t.confirm}</button>
                        <button type="button" disabled={acting} onClick={() => cancel(i)} className="btn-secondary px-3 py-1 text-xs">{t.cancel}</button>
                      </div>
                    </div>
                  )}
                  {m.done && (
                    <p className={`mt-2 text-xs font-medium ${m.done.ok ? "text-emerald-300" : "text-subtle"}`}>
                      {m.done.text}{m.done.link && <> · <Link href={m.done.link} className="underline">{t.see}</Link></>}
                    </p>
                  )}
                </div>
              </div>
            ))}
            {busy && <p className="animate-pulse text-xs text-muted">{t.thinking}</p>}
            <div ref={end} />
          </div>

          <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="border-t border-line p-3">
            <div className="flex gap-2">
              <textarea value={input} onChange={(e) => setInput(e.target.value.slice(0, 2000))} rows={1} placeholder={t.placeholder} aria-label={t.placeholder}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
                className="input max-h-32 min-h-[40px] flex-1 resize-none py-2 text-sm" />
              <button disabled={busy || !input.trim()} className="btn-primary px-3 py-2 text-sm" aria-label={t.send}><Icon name="arrowRight" className="h-4 w-4" /></button>
            </div>
            <p className="mt-1.5 text-[11px] text-subtle">{t.note}</p>
          </form>
        </div>
      )}
    </>
  );
}
