"use client";
import { fmt, type Dict } from "@/lib/i18n";

type Def = { name: string; required: boolean; mode: "FREE_TEXT" | "SELECTION_ONLY"; multi: boolean; values: string[] };
const field = "mt-1 w-full input py-2 text-sm";
const brandish = (name: string) => ["brand", "marke", "marque", "marca"].includes(name.toLowerCase());

/** Caractéristiques eBay de l'annonce (obligatoires en premier) ; `skip` : celles qui varient (gérées par les variantes). */
export function missingAspects(defs: Def[], aspects: Record<string, string[]>, skip: Set<string> = new Set()): string[] {
  return defs.filter((d) => d.required && !aspects[d.name]?.length && !skip.has(d.name.toLowerCase())).map((d) => d.name);
}

export default function AspectFields({ t, defs, aspects, onChange, skip = new Set(), lockBrand = true }: {
  t: Dict["listing"];
  defs: Def[];
  aspects: Record<string, string[]>;
  onChange: (a: Record<string, string[]>) => void;
  skip?: Set<string>;
  lockBrand?: boolean;
}) {
  const shown = [...defs].filter((d) => !skip.has(d.name.toLowerCase())).sort((a, b) => Number(b.required) - Number(a.required));
  const extra = Object.keys(aspects).filter((n) => !defs.some((d) => d.name === n) && !skip.has(n.toLowerCase()));
  const missing = missingAspects(defs, aspects, skip);
  return (
    <div>
      <h3 className="text-sm font-semibold">{t.aspects}</h3>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {shown.map((d) => (
          <label key={d.name} className="block text-sm">
            <span className="font-medium">{d.name}</span>
            {d.required && <span className="ml-1 text-xs text-red-400">({t.required})</span>}
            {lockBrand && brandish(d.name) ? (
              <input value={aspects[d.name]?.join(", ") ?? ""} readOnly className={`${field} bg-surface-2 text-muted`} />
            ) : d.mode === "SELECTION_ONLY" && d.values.length ? (
              <select value={aspects[d.name]?.[0] ?? ""} onChange={(e) => onChange({ ...aspects, [d.name]: e.target.value ? [e.target.value] : [] })} className={field}>
                <option value="">{t.choose}</option>
                {d.values.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            ) : (
              <input
                value={aspects[d.name]?.join(", ") ?? ""}
                onChange={(e) => onChange({ ...aspects, [d.name]: e.target.value.split(d.multi ? "," : /$^/).map((v) => v.trim()).filter(Boolean) })}
                list={d.values.length ? `vals-${d.name}` : undefined}
                className={field}
              />
            )}
            {d.mode === "FREE_TEXT" && d.values.length > 0 && <datalist id={`vals-${d.name}`}>{d.values.slice(0, 50).map((v) => <option key={v} value={v} />)}</datalist>}
          </label>
        ))}
        {extra.map((n) => (
          <label key={n} className="block text-sm">
            <span className="font-medium">{n}</span>
            <input value={aspects[n]?.join(", ") ?? ""} onChange={(e) => onChange({ ...aspects, [n]: e.target.value.split(",").map((v) => v.trim()).filter(Boolean) })} className={field} />
          </label>
        ))}
      </div>
      {missing.length > 0 && <p className="mt-2 text-sm text-red-400">{fmt(t.missing, { names: missing.join(", ") })}</p>}
    </div>
  );
}
