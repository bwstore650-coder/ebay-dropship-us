"use client";
import { useRef, useState } from "react";

/** Déplace l'élément `from` à la position `to` (copie). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it);
  return next;
}

export interface HandleProps {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
  "aria-label": string;
  role: "button";
  tabIndex: 0;
  style: React.CSSProperties;
  "data-sort-handle": "";
}

/**
 * Liste réordonnable à la souris, au doigt et au clavier (comme Shopify) : on attrape la poignée ⋮⋮ et on glisse.
 * Fonctionne en liste verticale comme en grille (photos) : la position suit l'élément sous le pointeur.
 */
export default function SortableList<T>({
  items, getKey, onChange, renderItem, className, itemClassName, handleLabel,
}: {
  items: T[];
  getKey: (item: T) => string;
  onChange: (items: T[]) => void;
  renderItem: (item: T, index: number, handle: HandleProps, dragging: boolean) => React.ReactNode;
  className?: string;
  itemClassName?: string;
  handleLabel: (index: number) => string; // ex. « Déplacer 20 Pair (position 2) »
}) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  function onPointerDown(e: React.PointerEvent<HTMLElement>, key: string) {
    if (e.button !== 0) return;
    e.preventDefault();
    setDragKey(key);
    const move = (ev: PointerEvent) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-sort-key]");
      if (!el || !listRef.current?.contains(el)) return;
      const cur = itemsRef.current;
      const from = cur.findIndex((it) => getKey(it) === key);
      const to = cur.findIndex((it) => getKey(it) === el.dataset.sortKey);
      if (from >= 0 && to >= 0 && from !== to) onChange(moveItem(cur, from, to));
    };
    const up = () => {
      setDragKey(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLElement>, index: number) {
    const delta = e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : 0;
    if (!delta) return;
    e.preventDefault();
    const to = index + delta;
    if (to < 0 || to >= items.length) return;
    onChange(moveItem(items, index, to));
    // Garde le focus sur la poignée de l'élément déplacé.
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-sort-key="${CSS.escape(getKey(items[index]))}"] [data-sort-handle]`)?.focus());
  }

  return (
    <div ref={listRef} className={className}>
      {items.map((item, i) => {
        const key = getKey(item);
        const dragging = dragKey === key;
        const handle: HandleProps = {
          onPointerDown: (e) => onPointerDown(e, key),
          onKeyDown: (e) => onKeyDown(e, i),
          "aria-label": handleLabel(i),
          role: "button",
          tabIndex: 0,
          style: { touchAction: "none", cursor: dragging ? "grabbing" : "grab" },
          "data-sort-handle": "",
        };
        return (
          <div key={key} data-sort-key={key} className={`${itemClassName ?? ""} ${dragging ? "relative z-10 opacity-80 ring-2 ring-brand-500/60" : ""}`}>
            {renderItem(item, i, handle, dragging)}
          </div>
        );
      })}
    </div>
  );
}

/** Poignée ⋮⋮ standard. */
export function DragHandle(props: HandleProps) {
  return (
    <span {...props} className="grid h-8 w-6 shrink-0 select-none place-items-center rounded text-subtle hover:bg-surface-3 hover:text-fg focus-visible:outline-2 focus-visible:outline-brand-400">
      <svg viewBox="0 0 10 16" className="h-4 w-2.5" fill="currentColor" aria-hidden="true">
        <circle cx="2" cy="2" r="1.4" /><circle cx="8" cy="2" r="1.4" /><circle cx="2" cy="8" r="1.4" /><circle cx="8" cy="8" r="1.4" /><circle cx="2" cy="14" r="1.4" /><circle cx="8" cy="14" r="1.4" />
      </svg>
    </span>
  );
}
