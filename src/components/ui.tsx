import { Icon, type IconName } from "@/components/icons";

/** Titre de page : titre, sous-titre et actions à droite. */
export function PageHeader({ title, subtitle, actions }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-fg sm:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const TONES = {
  brand: "bg-brand-500/12 text-brand-300 ring-brand-500/20",
  emerald: "bg-emerald-500/12 text-emerald-300 ring-emerald-500/20",
  amber: "bg-amber-500/12 text-amber-300 ring-amber-500/20",
  sky: "bg-sky-500/12 text-sky-300 ring-sky-500/20",
  fuchsia: "bg-fuchsia-500/12 text-fuchsia-300 ring-fuchsia-500/20",
} as const;

/** Carte de chiffre clé avec icône. */
export function StatCard({ label, value, hint, icon, tone = "brand" }: { label: string; value: React.ReactNode; hint?: React.ReactNode; icon: IconName; tone?: keyof typeof TONES }) {
  return (
    <div className="card min-w-0 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-muted sm:text-sm">{label}</p>
        <span className={`hidden h-8 w-8 shrink-0 place-items-center rounded-lg ring-1 sm:grid ${TONES[tone]}`}>
          <Icon name={icon} className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-3 truncate text-xl leading-none font-semibold tracking-tight text-fg tabular-nums sm:text-[28px]">{value}</p>
      {hint && <p className="mt-2 text-xs text-subtle">{hint}</p>}
    </div>
  );
}

/** Bandeau d'information (succès, alerte, erreur). */
export function Notice({ tone = "amber", children, className = "" }: { tone?: "amber" | "emerald" | "red" | "brand"; children: React.ReactNode; className?: string }) {
  const c = {
    amber: "border-amber-500/25 bg-amber-500/10 text-amber-200",
    emerald: "border-emerald-500/25 bg-emerald-500/10 text-emerald-200",
    red: "border-red-500/25 bg-red-500/10 text-red-200",
    brand: "border-brand-500/25 bg-brand-500/10 text-brand-200",
  }[tone];
  const icon: IconName = tone === "emerald" ? "check" : "alert";
  return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${c} ${className}`}>
      <Icon name={icon} className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Pastilles de statut, partagées par annonces et commandes. */
export const STATUS_TONE = {
  neutral: "bg-surface-3 text-fg-2",
  brand: "bg-brand-500/15 text-brand-300",
  sky: "bg-sky-500/15 text-sky-300",
  emerald: "bg-emerald-500/15 text-emerald-300",
  amber: "bg-amber-500/15 text-amber-300",
  red: "bg-red-500/15 text-red-300",
} as const;

export function StatusBadge({ tone, children }: { tone: keyof typeof STATUS_TONE; children: React.ReactNode }) {
  return (
    <span className={`badge ${STATUS_TONE[tone]}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {children}
    </span>
  );
}
