import Link from "next/link";
import { fmt, type Dict } from "@/lib/i18n";
import { marketplace, type MarketplaceId } from "@/lib/marketplaces";
import type { TrendRow } from "@/lib/research-service";
import { Icon } from "@/components/icons";

/** Carte d'un produit qui se vend (tableau de bord et page Meilleures ventes). */
export default function TrendCard({ item, t, marketId }: { item: TrendRow; t: Dict["research"]; marketId: MarketplaceId }) {
  const sym = marketplace(marketId).symbol;
  const q = item.title.split(/\s+/).slice(0, 6).join(" ");
  return (
    <article className="card flex min-w-0 flex-col p-0">
      <div className="relative">
        {item.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.image} alt="" loading="lazy" className="aspect-square w-full rounded-t-2xl bg-white object-contain p-3" />
        ) : (
          <span className="grid aspect-square w-full place-items-center rounded-t-2xl bg-surface-2 text-subtle"><Icon name="box" /></span>
        )}
        {item.daySales ? (
          <span className="badge absolute top-2 left-2 bg-emerald-500 text-[11px] text-white shadow"><Icon name="fire" className="h-3 w-3" />{fmt(t.daySales, { n: item.daySales })}</span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col p-3">
        {item.url ? (
          <a href={item.url} target="_blank" rel="noopener noreferrer" className="line-clamp-2 text-xs font-medium text-fg hover:text-brand-200" title={item.title}>{item.title} <span aria-hidden="true">↗</span></a>
        ) : (
          <p className="line-clamp-2 text-xs font-medium text-fg" title={item.title}>{item.title}</p>
        )}
        <p className="mt-1 text-[11px] text-subtle">{(t.niches as Record<string, string>)[item.niche] ?? item.categoryName}</p>
        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div>
            <p className="text-sm font-semibold text-fg tabular-nums">{item.price.toFixed(2)} {sym}</p>
            <p className="text-[11px] text-muted">{fmt(t.totalSold, { n: item.sold })}</p>
          </div>
          <Link href={`/finder?q=${encodeURIComponent(q)}`} className="grid h-8 w-8 place-items-center rounded-lg bg-brand-500/15 text-brand-200 hover:bg-brand-500/25" title={t.check} aria-label={t.check}>
            <Icon name="search" className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </article>
  );
}
