"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Dict } from "@/lib/i18n";
import { fmt } from "@/lib/i18n";
import { errorMessage } from "@/lib/i18n/errors";
import { TITLE_MAX } from "@/lib/listing";
import type { ListingContent } from "@/lib/listing-service";
import { AiTitlePicker, AiUsageLine } from "./AiTitlePicker";
import { useAiGenerate } from "./useAiGenerate";

/** « Mes annonces » : réécrire le titre et la description d'une annonce en ligne avec l'IA, puis mettre à jour eBay. */
export default function ImproveListingButton({ listingId, t, errors, titleCount }: { listingId: string; t: Dict["listing"]["ai"]; errors: Dict["errors"]; titleCount: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<ListingContent | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ideas, setIdeas] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const ai = useAiGenerate(null);

  async function start() {
    setOpen(true);
    setError(null);
    setSaved(false);
    const res = await fetch(`/api/listings/${encodeURIComponent(listingId)}/content`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(fmt(errorMessage(errors, data.error), { detail: data.detail ?? "" }));
    const c = data as ListingContent;
    setContent(c);
    setTitle(c.title);
    setDescription(c.descriptionHtml);
    const usage = await fetch("/api/ai/usage").then((r) => r.json()).catch(() => null);
    if (usage && !usage.error) ai.setUsage(usage);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/listings/${encodeURIComponent(listingId)}/content`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, descriptionHtml: description }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return setError(fmt(errorMessage(errors, data.error), { detail: data.detail ?? "" }));
    setSaved(true);
    router.refresh();
  }

  return (
    <>
      <button type="button" onClick={start} className="font-medium text-brand-300 hover:text-brand-200">✦ {t.improveButton}</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="card my-8 w-full max-w-2xl space-y-4 text-left whitespace-normal">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-fg">✦ {t.improveTitle}</h2>
                <p className="mt-1 text-sm text-muted">{t.improveIntro}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="text-xl text-muted hover:text-fg" aria-label={t.cancel}>×</button>
            </div>
            {!content && !error && <p className="animate-pulse text-sm text-muted">{t.loadingCurrent}</p>}
            {content && (
              <>
                <div>
                  <p className="text-xs text-subtle">{t.currentTitle} : {content.title}</p>
                  <label className="mt-3 block text-sm font-medium">
                    {t.newTitle}
                    <input value={title} maxLength={TITLE_MAX} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full input py-2 text-sm" />
                    <span className="mt-1 block text-xs text-muted">{fmt(titleCount, { n: title.length })}</span>
                  </label>
                  {ideas.length > 0 ? (
                    <AiTitlePicker t={t} titles={ideas} current={title} onPick={setTitle} busy={ai.busy === "titles"} onRegenerate={async () => {
                      const r = await ai.run("titles", { ...content.aiContext, currentTitle: title });
                      if (r) setIdeas(r.titles);
                    }} />
                  ) : (
                    <button type="button" disabled={ai.busy === "titles"} onClick={async () => {
                      const r = await ai.run("titles", { ...content.aiContext, currentTitle: title });
                      if (r) setIdeas(r.titles);
                    }} className="btn-secondary mt-2 px-3 py-1.5 text-sm">✦ {ai.busy === "titles" ? t.writing : t.titleIdeas}</button>
                  )}
                </div>
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{t.newDescription}</p>
                    <button type="button" disabled={ai.busy === "description"} onClick={async () => {
                      const r = await ai.run("description", { ...content.aiContext });
                      if (r) setDescription(r.descriptionHtml);
                    }} className="text-sm font-medium text-brand-300 hover:underline disabled:opacity-60">✦ {ai.busy === "description" ? t.writing : t.rewriteDescription}</button>
                  </div>
                  <iframe title={t.newDescription} sandbox="" srcDoc={`<meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;font-size:14px;color:#0f172a;margin:12px;line-height:1.5}</style>${description}`} className="mt-2 h-56 w-full rounded-lg border border-line bg-white" />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <AiUsageLine t={t} usage={ai.usage} />
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setOpen(false)} className="btn-secondary px-4 py-2 text-sm">{t.cancel}</button>
                    <button type="button" onClick={save} disabled={saving || saved || title.trim().length < 10} className="btn-primary px-4 py-2 text-sm">{saving ? t.updating : t.updateOnEbay}</button>
                  </div>
                </div>
              </>
            )}
            {ai.error && <p className="text-sm text-red-400">{errorMessage(errors, ai.error)}</p>}
            {error && <p className="text-sm text-red-400">{error}</p>}
            {saved && <p className="rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300">✓ {t.updated}</p>}
          </div>
        </div>
      )}
    </>
  );
}
