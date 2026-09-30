"use client";
import { useState } from "react";
import type { DayPoint } from "@/lib/dashboard";

/**
 * Ventes par jour : barre du chiffre d'affaires, avec le profit net dans la même barre (même unité, un seul axe).
 * Survol ou toucher d'un jour : infobulle avec le détail.
 */
export default function SalesChart({ points, labels, localeTag, symbol }: {
  points: DayPoint[];
  labels: { revenue: string; profit: string; orders: string };
  localeTag: string; // ex. fr-FR
  symbol: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const money = (v: number) => new Intl.NumberFormat(localeTag, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) + " " + symbol;
  const dateFmt = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(localeTag, { day: "numeric", month: "short", timeZone: "UTC" });
  const W = 640;
  const H = 200;
  const L = 44; // place des montants à gauche
  const B = 22; // place des dates en bas
  const top = 8;
  const max = Math.max(1, ...points.map((p) => p.revenue));
  const nice = niceMax(max);
  const y = (v: number) => top + (H - B - top) * (1 - Math.max(0, v) / nice);
  const slot = (W - L) / points.length;
  const bw = Math.max(3, Math.min(14, slot - 4));
  const ticks = [0, nice / 2, nice];
  const p = hover !== null ? points[hover] : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${labels.revenue} / ${labels.profit}`} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W} y1={y(t)} y2={y(t)} className="stroke-line" strokeWidth={1} />
            <text x={L - 6} y={y(t) + 3} textAnchor="end" className="fill-subtle text-[10px] tabular-nums">{short(t)}</text>
          </g>
        ))}
        {points.map((pt, i) => {
          const cx = L + slot * i + slot / 2;
          const active = hover === i;
          return (
            <g key={pt.day} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
              <rect x={L + slot * i} y={top} width={slot} height={H - B - top} fill="transparent" />
              {pt.revenue > 0 && (
                <rect x={cx - bw / 2} y={y(pt.revenue)} width={bw} height={Math.max(2, y(0) - y(pt.revenue))} rx={Math.min(4, bw / 2)} className={active ? "fill-brand-300" : "fill-brand-300/60"} />
              )}
              {pt.profit > 0 && (
                <rect x={cx - bw / 2} y={y(pt.profit)} width={bw} height={Math.max(2, y(0) - y(pt.profit))} rx={Math.min(4, bw / 2)} className="fill-brand-500 stroke-surface" strokeWidth={1} />
              )}
            </g>
          );
        })}
        {[0, Math.floor(points.length / 2), points.length - 1].map((i) => (
          <text key={i} x={L + slot * i + slot / 2} y={H - 6} textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"} className="fill-subtle text-[10px]">
            {dateFmt(points[i].day)}
          </text>
        ))}
      </svg>
      {p && (
        <div className="pointer-events-none absolute top-0 right-0 rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-xs shadow-lg">
          <p className="font-medium text-fg">{dateFmt(p.day)}</p>
          <p className="mt-1 flex items-center gap-2 text-fg-2"><span className="h-2 w-2 rounded-sm bg-brand-300/60" />{labels.revenue} <span className="ml-auto tabular-nums">{money(p.revenue)}</span></p>
          <p className="flex items-center gap-2 text-fg-2"><span className="h-2 w-2 rounded-sm bg-brand-500" />{labels.profit} <span className="ml-auto pl-3 tabular-nums">{money(p.profit)}</span></p>
          <p className="text-muted">{p.orders} {labels.orders}</p>
        </div>
      )}
      <ul className="mt-2 flex gap-4 text-xs text-muted">
        <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-brand-300/60" />{labels.revenue}</li>
        <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-brand-500" />{labels.profit}</li>
      </ul>
    </div>
  );
}

function niceMax(v: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function short(v: number): string {
  return v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v));
}
