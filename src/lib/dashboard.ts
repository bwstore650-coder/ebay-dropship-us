/**
 * Chiffres du tableau de bord (fonctions pures, testées) : séries par jour, périodes comparées,
 * meilleurs produits et ventes par pays. Seules les commandes réellement passées comptent (commandée ou expédiée).
 */

export interface DashOrder {
  status: string;
  currency: string;
  marketplace: string;
  saleTotal: number | null;
  profit: number | null;
  createdAt: Date;
  lines: { title?: string; quantity?: number; listingId?: string }[] | null;
}

export const COUNTED = new Set(["ORDERED", "SHIPPED"]);
const DAY = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface Totals { orders: number; revenue: number; profit: number; units: number }

/** Totaux d'une période [from, to[ pour une devise. */
export function totals(orders: DashOrder[], currency: string, from: Date, to: Date): Totals {
  const t = { orders: 0, revenue: 0, profit: 0, units: 0 };
  for (const o of orders) {
    if (!COUNTED.has(o.status) || o.currency !== currency || o.createdAt < from || o.createdAt >= to) continue;
    t.orders++;
    t.revenue += o.saleTotal ?? 0;
    t.profit += o.profit ?? 0;
    t.units += (o.lines ?? []).reduce((s, l) => s + (l.quantity ?? 1), 0) || 1;
  }
  return { ...t, revenue: round2(t.revenue), profit: round2(t.profit) };
}

/** Évolution en % par rapport à la période précédente (null si rien avant). */
export function change(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}

export interface DayPoint { day: string; revenue: number; profit: number; orders: number }

/** Une valeur par jour (UTC) sur les `days` derniers jours, le plus ancien en premier. */
export function dailySeries(orders: DashOrder[], currency: string, days: number, now = new Date()): DayPoint[] {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1));
  const out: DayPoint[] = Array.from({ length: days }, (_, i) => ({ day: new Date(start + i * DAY).toISOString().slice(0, 10), revenue: 0, profit: 0, orders: 0 }));
  for (const o of orders) {
    if (!COUNTED.has(o.status) || o.currency !== currency) continue;
    const i = Math.floor((o.createdAt.getTime() - start) / DAY);
    if (i < 0 || i >= days) continue;
    out[i].revenue += o.saleTotal ?? 0;
    out[i].profit += o.profit ?? 0;
    out[i].orders++;
  }
  return out.map((p) => ({ ...p, revenue: round2(p.revenue), profit: round2(p.profit) }));
}

export interface TopProduct { title: string; orders: number; units: number; revenue: number; profit: number }

/** Produits qui rapportent le plus (regroupés par annonce, sinon par titre). */
export function topProducts(orders: DashOrder[], currency: string, n = 5): TopProduct[] {
  const map = new Map<string, TopProduct>();
  for (const o of orders) {
    if (!COUNTED.has(o.status) || o.currency !== currency) continue;
    const lines = o.lines ?? [];
    const first = lines[0];
    if (!first) continue;
    const key = first.listingId ?? first.title ?? "?";
    const p = map.get(key) ?? { title: first.title ?? "—", orders: 0, units: 0, revenue: 0, profit: 0 };
    p.orders++;
    p.units += lines.reduce((s, l) => s + (l.quantity ?? 1), 0);
    p.revenue += o.saleTotal ?? 0;
    p.profit += o.profit ?? 0;
    map.set(key, p);
  }
  return [...map.values()]
    .map((p) => ({ ...p, revenue: round2(p.revenue), profit: round2(p.profit) }))
    .sort((a, b) => b.profit - a.profit || b.revenue - a.revenue)
    .slice(0, n);
}

/** Commandes par pays eBay (toutes devises), du plus vendu au moins vendu. */
export function ordersByMarket(orders: DashOrder[]): { marketplace: string; orders: number }[] {
  const map = new Map<string, number>();
  for (const o of orders) if (COUNTED.has(o.status)) map.set(o.marketplace, (map.get(o.marketplace) ?? 0) + 1);
  return [...map.entries()].map(([marketplace, n]) => ({ marketplace, orders: n })).sort((a, b) => b.orders - a.orders);
}
