"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MarketplaceId } from "@/lib/marketplaces";
import type { RunState } from "@/lib/sniper-service";

type Candidate = RunState["candidates"][number];

const keyOf = (supplier: string, productId: string) => `${supplier}:${productId}`;

/**
 * Produits sauvegardés de l'utilisateur, pour marquer les fiches et les ajouter / retirer en un clic.
 * Mise à jour immédiate à l'écran, annulée si le serveur refuse ; onError reçoit le code d'erreur.
 */
export function useSavedProducts(marketId: MarketplaceId, onError?: (code: string) => void) {
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const errRef = useRef(onError);
  errRef.current = onError;

  useEffect(() => {
    let alive = true;
    fetch("/api/saved?keys=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && Array.isArray(d?.keys) && setKeys(new Set(d.keys as string[])))
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const isSaved = useCallback((c: Candidate) => Boolean(c.supplier && c.productId && keys.has(keyOf(c.supplier, c.productId))), [keys]);

  const toggle = useCallback(async (c: Candidate) => {
    if (!c.supplier || !c.productId) return;
    const k = keyOf(c.supplier, c.productId);
    if (busy.has(k)) return;
    const wasSaved = keys.has(k);
    const flip = (on: boolean) => setKeys((s) => { const n = new Set(s); if (on) n.add(k); else n.delete(k); return n; });
    flip(!wasSaved);
    setBusy((s) => new Set(s).add(k));
    try {
      const res = wasSaved
        ? await fetch(`/api/saved?${new URLSearchParams({ supplier: c.supplier, productId: c.productId })}`, { method: "DELETE" })
        : await fetch("/api/saved", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              supplier: c.supplier, productId: c.productId, title: c.title, image: c.image, keyword: c.keyword, marketId,
              // Les prix eBay d'une analyse expirée sont masqués : on ne les garde pas.
              price: c.expired ? null : c.marketPrice, cost: c.cost, profit: c.expired ? null : c.profit, marginPct: c.expired ? null : c.marginPct,
            }),
          });
      if (!res.ok) {
        flip(wasSaved);
        errRef.current?.(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "GENERIC");
      }
    } catch {
      flip(wasSaved);
      errRef.current?.("GENERIC");
    } finally {
      setBusy((s) => { const n = new Set(s); n.delete(k); return n; });
    }
  }, [busy, keys, marketId]);

  return { isSaved, toggle };
}
