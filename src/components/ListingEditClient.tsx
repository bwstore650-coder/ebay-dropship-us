"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { fmt, type Dict } from "@/lib/i18n";
import { errorMessage } from "@/lib/i18n/errors";
import { cleanTitle, TITLE_MAX } from "@/lib/listing";
import type { FullListing } from "@/lib/listing-service";
import AspectFields, { missingAspects } from "@/components/AspectFields";
import PhotoSorter from "@/components/PhotoSorter";
import SortableList, { DragHandle } from "@/components/SortableList";

const field = "mt-1 w-full input py-2 text-sm";
const num = (s: string) => Number(s.replace(",", "."));
type VRow = FullListing["variants"][number] & { priceText: string };

/** Édition complète d'une annonce en ligne : tout est relu chez eBay, puis renvoyé d'un coup (même annonce). */
export default function ListingEditClient({ id, t, tl, errors }: { id: string; t: Dict["listings"]["editor"]; tl: Dict["listing"]; errors: Dict["errors"] }) {
  const router = useRouter();
  const [data, setData] = useState<FullListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [editHtml, setEditHtml] = useState(false);
  const [aspects, setAspects] = useState<Record<string, string[]>>({});
  const [photos, setPhotos] = useState<string[]>([]);
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [rows, setRows] = useState<VRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const showError = (d: { error?: string; detail?: string }) => setError(fmt(errorMessage(errors, d.error ?? "UPSTREAM"), { detail: d.detail ?? "" }));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/listings/${encodeURIComponent(id)}/full`);
      const d = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (!res.ok) return showError(d);
      const l = d as FullListing;
      setData(l);
      setTitle(l.title);
      setDescription(l.descriptionHtml);
      setAspects(l.aspects);
      setPhotos(l.images.slice(0, 12));
      setPrice(l.price != null ? l.price.toFixed(2) : "");
      setQuantity(l.quantity ?? 1);
      setRows(l.variants.map((v) => ({ ...v, priceText: v.price.toFixed(2) })));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Toute modification : il faut de nouveau confirmer avant l'envoi à eBay.
  const edit = <T,>(set: (v: T) => void) => (v: T) => { set(v); setDirty(true); setSaved(false); setConfirming(false); };

  const skip = useMemo(() => new Set((data?.variationNames ?? []).map((n) => n.toLowerCase())), [data]);
  const available = useMemo(() => (data ? [...data.images, ...data.variants.map((v) => v.image).filter((x): x is string => Boolean(x))] : []), [data]);
  if (!data) return <div className="card">{error ? <p className="text-red-400">{error}</p> : <p className="animate-pulse text-muted">{t.loading}</p>}</div>;

  const money = (v: number) => `${v.toFixed(2)} ${data.currency}`;
  const group = data.kind === "group";
  const priceLow = !group && (!(num(price) > 0) || (data.minPrice != null && num(price) < data.minPrice));
  const rowLow = (r: VRow) => !(num(r.priceText) > 0) || (r.minPrice != null && num(r.priceText) < r.minPrice);
  const missing = missingAspects(data.aspectDefs, aspects, skip);
  const ready = title.trim().length >= 10 && photos.length > 0 && missing.length === 0 && !priceLow && !(group && rows.some(rowLow));

  async function save() {
    if (!data) return;
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/listings/${encodeURIComponent(id)}/full`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title, descriptionHtml: description, images: photos, aspects,
        ...(group
          ? { variants: rows.map((r) => ({ id: r.id, price: num(r.priceText), quantity: r.quantity })) }
          : { price: num(price), quantity }),
      }),
    });
    const d = await res.json().catch(() => ({}));
    setSaving(false);
    setConfirming(false);
    if (!res.ok) return showError(d);
    setSaved(true);
    setDirty(false);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {data.status === "PAUSED" && <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-300">{t.pausedNote}</p>}

      {/* Photos */}
      <section className="card">
        <h2 className="font-semibold text-fg">{fmt(t.photos, { n: photos.length })}</h2>
        <div className="mt-3">
          <PhotoSorter images={photos} available={available} onChange={edit(setPhotos)}
            t={{ main: tl.photoMain, remove: tl.photoRemove, move: tl.photoMove, add: tl.photoAdd, hint: tl.photoHint }} />
        </div>
      </section>

      {/* Titre et description */}
      <section className="card space-y-4">
        <h2 className="font-semibold text-fg">{t.details}</h2>
        <label className="block text-sm font-medium">
          {tl.titleLabel}
          <input value={title} maxLength={TITLE_MAX} onChange={(e) => edit(setTitle)(e.target.value)} onBlur={() => setTitle(cleanTitle(title))} className={field} />
          <span className={`mt-1 block text-xs ${title.length > TITLE_MAX ? "text-red-400" : "text-muted"}`}>{fmt(tl.titleCount, { n: title.length })}</span>
        </label>
        <div>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{tl.description}</h3>
            <button type="button" onClick={() => setEditHtml(!editHtml)} className="text-sm font-medium text-brand-400 hover:underline">{editHtml ? tl.preview : tl.edit}</button>
          </div>
          {editHtml ? (
            <textarea value={description} onChange={(e) => edit(setDescription)(e.target.value)} rows={14} className={`${field} font-mono text-xs`} />
          ) : (
            <iframe title={tl.preview} sandbox="" srcDoc={`<meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;font-size:14px;color:#0f172a;margin:12px;line-height:1.5}img{max-width:100%}</style>${description}`} className="mt-2 h-80 w-full rounded-lg border border-line bg-white" />
          )}
        </div>
      </section>

      {/* Prix et quantité (annonce simple) */}
      {!group && (
        <section className="card">
          <h2 className="font-semibold text-fg">{t.pricing}</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium">
              {fmt(tl.price, { currency: data.currency })}
              <input inputMode="decimal" value={price} onChange={(e) => edit(setPrice)(e.target.value)} className={`${field} ${priceLow ? "ring-1 ring-red-400" : ""}`} />
              {data.minPrice != null && <span className={`mt-1 block text-xs ${priceLow ? "text-red-300" : "text-muted"}`}>{fmt(t.minPrice, { min: money(data.minPrice) })}</span>}
            </label>
            <label className="block text-sm font-medium">
              {tl.quantity}
              <input type="number" min={1} max={10} value={quantity} onChange={(e) => edit(setQuantity)(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} className={field} />
            </label>
          </div>
        </section>
      )}

      {/* Variantes : glisser pour changer l'ordre (la première = principale) */}
      {group && (
        <section className="card space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold text-fg">{fmt(t.variants, { n: rows.length })}</h2>
            <span className="text-xs text-muted">{data.variationNames.join(" · ")}</span>
          </div>
          <p className="text-xs text-subtle">{t.variantsHelp}</p>
          <SortableList
            items={rows}
            getKey={(r) => r.id}
            onChange={edit(setRows)}
            className="divide-y divide-line overflow-hidden rounded-xl border border-line"
            itemClassName="bg-surface"
            handleLabel={(i) => fmt(tl.variantMove, { n: i + 1 })}
            renderItem={(r, i, handle) => {
              const set = (patch: Partial<VRow>) => edit(setRows)(rows.map((x) => (x.id === r.id ? { ...x, ...patch } : x)));
              const low = rowLow(r);
              return (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-2 py-2 sm:flex-nowrap">
                  <DragHandle {...handle} />
                  <span className="w-5 shrink-0 text-center text-xs tabular-nums text-subtle">{i + 1}</span>
                  {r.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.image} alt="" className="h-10 w-10 shrink-0 rounded bg-white object-contain" draggable={false} />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-fg-2">{Object.values(r.options).join(" · ") || r.label}</span>
                    <span className="block text-[11px] text-subtle">
                      {i === 0 && <span className="font-semibold text-brand-300">{tl.variantMain}</span>}
                      {r.status === "PAUSED" && <span className="text-amber-300">{i === 0 ? " · " : ""}{t.paused}</span>}
                    </span>
                  </span>
                  <label className="text-[11px] text-subtle">
                    {fmt(tl.price, { currency: data.currency })}
                    <input inputMode="decimal" value={r.priceText} onChange={(e) => set({ priceText: e.target.value })} className={`input mt-0.5 block w-24 py-1 text-sm tabular-nums ${low ? "ring-1 ring-red-400" : ""}`} aria-label={`${tl.variantCol} ${r.label}`} />
                    {r.minPrice != null && <span className={`block ${low ? "text-red-300" : ""}`}>{fmt(tl.variantMin, { min: money(r.minPrice) })}</span>}
                  </label>
                  <label className="text-[11px] text-subtle">
                    {tl.quantity}
                    <input type="number" min={1} max={10} value={r.quantity} onChange={(e) => set({ quantity: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })} className="input mt-0.5 block w-16 py-1 text-sm" aria-label={tl.quantity} />
                  </label>
                </div>
              );
            }}
          />
        </section>
      )}

      {/* Caractéristiques */}
      <section className="card">
        <AspectFields t={tl} defs={data.aspectDefs} aspects={aspects} onChange={edit(setAspects)} skip={skip} />
      </section>

      {error && <p className="rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      {saved && <p className="rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300">✓ {t.saved}</p>}

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface/95 p-3 shadow-lg backdrop-blur">
        {confirming ? (
          <>
            <span className="text-sm text-fg-2">{t.confirm}</span>
            <button type="button" onClick={save} disabled={saving} className="btn-primary">{saving ? t.saving : t.save}</button>
            <button type="button" onClick={() => setConfirming(false)} disabled={saving} className="btn-secondary">{t.cancel}</button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setConfirming(true)} disabled={!ready || !dirty} className="btn-primary">{t.save}</button>
            {dirty && <span className="text-xs text-amber-300">{t.unsaved}</span>}
          </>
        )}
        {data.url && <a href={data.url} target="_blank" rel="noopener noreferrer" className="ml-auto text-sm font-medium text-brand-300 hover:text-brand-200">{tl.view}</a>}
      </div>
    </div>
  );
}
