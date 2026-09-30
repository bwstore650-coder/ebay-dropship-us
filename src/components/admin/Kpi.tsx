export function Kpi({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border p-5 ${accent ? "border-brand-500/30 bg-brand-500/10" : "border-line bg-surface"}`}>
      <p className="text-sm text-muted">{label}</p>
      <p className={`mt-1 text-3xl font-bold tracking-tight ${accent ? "text-brand-300" : "text-fg"}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="font-semibold text-fg">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Histogramme simple en CSS (pas de dépendance). */
export function Bars({ data }: { data: { day: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div>
      <div className="flex h-40 items-end gap-1">
        {data.map((d) => (
          <div key={d.day} className="group relative flex h-full flex-1 items-end" title={`${d.day} : ${d.count}`}>
            <div className="w-full rounded-t bg-brand-500/80 transition group-hover:bg-brand-600" style={{ height: `${(d.count / max) * 100}%`, minHeight: d.count ? 4 : 1 }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-xs text-subtle">
        <span>{data[0]?.day}</span>
        <span>{data[data.length - 1]?.day}</span>
      </div>
    </div>
  );
}
