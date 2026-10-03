"use client";
import { useState } from "react";
import type { TrafficDay } from "@/lib/traffic";

type Metric = "impressions" | "views" | "sold";

/** Barres par jour (impressions, vues ou ventes), au choix ; survol = valeur du jour. */
export default function TrafficChart({ series, labels, localeTag }: { series: TrafficDay[]; labels: Record<Metric, string>; localeTag: string }) {
  const [metric, setMetric] = useState<Metric>("impressions");
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = 200, L = 44, B = 22, top = 8;
  const val = (p: TrafficDay) => (metric === "impressions" ? p.impressions : metric === "views" ? p.views : p.sold);
  const max = Math.max(1, ...series.map(val));
  const nice = niceMax(max);
  const y = (v: number) => top + (H - B - top) * (1 - v / nice);
  const slot = (W - L) / Math.max(1, series.length);
  const bw = Math.max(2, Math.min(14, slot - 3));
  const num = (v: number) => new Intl.NumberFormat(localeTag).format(v);
  const date = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(localeTag, { day: "numeric", month: "short", timeZone: "UTC" });
  const every = Math.ceil(series.length / 6);
  const p = hover !== null ? series[hover] : null;

  return (
    <div>
      <div className="flex gap-4 border-b border-line text-sm" role="tablist">
        {(["impressions", "views", "sold"] as Metric[]).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={metric === m} onClick={() => setMetric(m)}
            className={`-mb-px border-b-2 pb-2 font-medium ${metric === m ? "border-brand-400 text-fg" : "border-transparent text-muted hover:text-fg"}`}>
            {labels[m]}
          </button>
        ))}
      </div>
      <div className="relative mt-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={labels[metric]} onMouseLeave={() => setHover(null)}>
          {[0, nice / 2, nice].map((t) => (
            <g key={t}>
              <line x1={L} x2={W} y1={y(t)} y2={y(t)} className="stroke-line" strokeWidth={1} />
              <text x={L - 6} y={y(t) + 4} textAnchor="end" className="fill-subtle text-[10px]">{num(t)}</text>
            </g>
          ))}
          {series.map((d, i) => {
            const v = val(d);
            const x = L + i * slot + (slot - bw) / 2;
            return (
              <g key={d.day} onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)}>
                <rect x={L + i * slot} y={top} width={slot} height={H - B - top} fill="transparent" />
                <rect x={x} y={y(v)} width={bw} height={Math.max(0, H - B - y(v))} rx={2} className={hover === i ? "fill-brand-300" : "fill-brand-500"} />
                {i % every === 0 && <text x={x + bw / 2} y={H - 6} textAnchor="middle" className="fill-subtle text-[10px]">{date(d.day)}</text>}
              </g>
            );
          })}
        </svg>
        {p && (
          <div className="pointer-events-none absolute top-0 right-0 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
            <p className="font-medium text-fg">{date(p.day)}</p>
            <p className="tabular-nums text-muted">{labels.impressions} : {num(p.impressions)}</p>
            <p className="tabular-nums text-muted">{labels.views} : {num(p.views)}</p>
            <p className="tabular-nums text-muted">{labels.sold} : {num(p.sold)}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function niceMax(v: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
