"use client";
import { useState } from "react";
import type { Dict } from "@/lib/i18n";
import type { MarketplaceId } from "@/lib/marketplaces";
import { marketplace } from "@/lib/marketplaces";
import type { RunState } from "@/lib/sniper-service";
import ListingEditor from "@/components/ListingEditor";
import SniperProductCard from "@/components/SniperProductCard";
import { useSavedProducts } from "@/components/useSavedProducts";
import { errorMessage } from "@/lib/i18n/errors";

type Candidate = RunState["candidates"][number];

/** Produits gagnants (déjà analysés par Sellvela) : fiches complètes et création d'annonce en un clic. */
export default function WinnersGrid({
  items, t, tl, markets, errors, accounts, hasGpsr, marketId, minMargin,
}: {
  items: Candidate[];
  t: Dict["sniper"];
  tl: Dict["listing"];
  markets: Dict["markets"];
  errors: Dict["errors"];
  accounts: { id: string; label: string }[];
  hasGpsr: boolean;
  marketId: MarketplaceId;
  minMargin: number;
}) {
  const [editing, setEditing] = useState<Candidate | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { isSaved, toggle } = useSavedProducts(marketId, (code) => setSaveError(errorMessage(errors, code)));
  const sym = marketplace(marketId).symbol;
  const money = (v: number | null) => (v === null ? "—" : `${v.toFixed(2)} ${sym}`);
  return (
    <>
      {saveError && <p className="mb-3 text-sm text-red-300" role="alert">{saveError}</p>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((c) => (
          <SniperProductCard key={c.id} c={c} t={t} minMargin={minMargin} money={money} reason={null} onCreate={setEditing} collapsible marketId={marketId} saved={isSaved(c)} onToggleSave={(x) => { setSaveError(null); toggle(x); }} />
        ))}
      </div>
      {editing && editing.productId && editing.supplier && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:p-8" role="dialog" aria-modal="true">
          <div className="mx-auto max-w-4xl">
            <ListingEditor
              t={tl}
              errors={errors}
              markets={markets}
              accounts={accounts}
              hasGpsr={hasGpsr}
              keyword={editing.keyword}
              marketId={marketId}
              supplierRef={{ supplier: editing.supplier, productId: editing.productId, variantId: editing.variantId ?? undefined }}
              onClose={() => setEditing(null)}
            />
          </div>
        </div>
      )}
    </>
  );
}
