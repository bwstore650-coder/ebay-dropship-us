"use client";
import SortableList, { DragHandle } from "@/components/SortableList";

export const MAX_PHOTOS = 12;

/**
 * Photos de l'annonce : glisser pour changer l'ordre (la 1re est la photo principale), retirer, ou remettre
 * une photo du fournisseur. eBay accepte jusqu'à 12 photos.
 */
export default function PhotoSorter({ images, available, onChange, t }: {
  images: string[];
  available: string[]; // photos du fournisseur pas encore utilisées
  onChange: (images: string[]) => void;
  t: { main: string; remove: string; move: string; add: string; hint: string };
}) {
  const unused = available.filter((a) => !images.includes(a));
  return (
    <div className="space-y-2">
      <SortableList
        items={images}
        getKey={(s) => s}
        onChange={onChange}
        className="flex flex-wrap gap-2"
        handleLabel={(i) => `${t.move} ${i + 1}`}
        renderItem={(src, i, handle) => (
          <div className="relative h-24 w-24 overflow-hidden rounded-lg border border-line bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" loading="lazy" className="h-full w-full object-contain" draggable={false} />
            <span className="absolute top-1 left-1 rounded bg-black/55"><DragHandle {...handle} /></span>
            {i === 0 && <span className="absolute bottom-1 left-1 rounded bg-brand-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">{t.main}</span>}
            {images.length > 1 && (
              <button type="button" onClick={() => onChange(images.filter((x) => x !== src))} aria-label={t.remove}
                className="absolute top-1 right-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-xs text-white hover:bg-red-500">✕</button>
            )}
          </div>
        )}
      />
      {unused.length > 0 && images.length < MAX_PHOTOS && (
        <div>
          <p className="text-xs text-muted">{t.add}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {unused.slice(0, 24).map((src) => (
              <button key={src} type="button" onClick={() => onChange([...images, src].slice(0, MAX_PHOTOS))} className="h-12 w-12 overflow-hidden rounded border border-dashed border-line-strong bg-white opacity-70 hover:opacity-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" loading="lazy" className="h-full w-full object-contain" />
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="text-[11px] text-subtle">{t.hint}</p>
    </div>
  );
}
