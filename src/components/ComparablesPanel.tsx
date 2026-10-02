"use client";
import { useState } from "react";
import type { Dict } from "@/lib/i18n";
import { fmt } from "@/lib/i18n";
import { SHOW_SALES_DATA } from "@/lib/flags";

interface Item { id: string; title: string; price: number; url: string | null; image: string | null; sold: number | null }

/** Les 5 annonces eBay les plus proches du produit, chargées à la demande (pour vérifier que c'est le même produit). */
export default function ComparablesPanel({ t, image, keyword, marketId, money }: {
  t: Dict["sniper"]["card"];
  image: string;
  keyword: string;
  marketId: string;
  money: (v: number | null) => string;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  async function load() {
    setState("loading");
    const res = await fetch(`/api/comparables?${new URLSearchParams({ image, kw: keyword, m: marketId })}`).catch(() => null);
    const data = res?.ok ? ((await res.json().catch(() => null)) as { items?: Item[] } | null) : null;
    if (!data?.items) return setState("error");
    setItems(data.items);
    setState("idle");
  }

  if (!items) {
    return (
      <div>
        <button type="button" onClick={load} disabled={state === "loading"} className="text-xs font-medium text-brand-300 hover:text-brand-200">
          {state === "loading" ? t.comparablesLoading : t.comparablesShow}
        </button>
        {state === "error" && <p className="mt-1 text-xs text-red-300">{t.comparablesError}</p>}
      </div>
    );
  }
  return (
    <div>
      <p className="text-xs font-medium text-muted">{t.comparablesTitle}</p>
      {items.length === 0 ? (
        <p className="mt-1 text-xs text-subtle">{t.noMarket}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.map((i) => (
            <li key={i.id}>
              <a href={i.url ?? "#"} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 rounded-lg p-1 hover:bg-surface-2">
                {i.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={i.image} alt="" className="h-10 w-10 shrink-0 rounded-md bg-white object-contain" loading="lazy" />
                ) : (
                  <span className="h-10 w-10 shrink-0 rounded-md bg-surface-3" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-1 text-xs text-fg-2">{i.title}</span>
                  <span className="text-[11px] text-subtle tabular-nums">
                    {money(i.price)}{SHOW_SALES_DATA && i.sold !== null ? ` · ${fmt(t.estSalesValue, { n: i.sold })}` : ""}
                  </span>
                </span>
                <span aria-hidden="true" className="text-xs text-subtle">↗</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
