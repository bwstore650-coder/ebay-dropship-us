/** Outils de l'espace admin (calculs purs, testés). */
import type { Plan } from "@prisma/client";
import { PLANS } from "@/lib/plans";

export function parseAdminEmails(raw: string | undefined): string[] {
  return (raw ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined, admins: string[]): boolean {
  return !!email && admins.includes(email.toLowerCase());
}

export interface BillingRow {
  plan: Plan;
  billingInterval: string | null;
  trialEndsAt: Date | null;
}

export function isTrialing(u: BillingRow, now = new Date()): boolean {
  return u.plan !== "NONE" && !!u.trialEndsAt && u.trialEndsAt > now;
}

/** Revenu mensuel récurrent (en cents) des clients qui paient déjà (essais exclus). Annuel = prix annuel / 12. */
export function mrrCents(users: BillingRow[], now = new Date()): number {
  let total = 0;
  for (const u of users) {
    if (u.plan === "NONE" || isTrialing(u, now)) continue;
    const info = PLANS.find((p) => p.id === u.plan);
    if (!info) continue;
    total += u.billingInterval === "year" ? Math.round((info.yearlyUsd * 100) / 12) : info.priceUsd * 100;
  }
  return total;
}

/** Nombre d'éléments par jour sur les `days` derniers jours (le plus ancien en premier). */
export function dailyCounts(dates: Date[], days: number, now = new Date()): { day: string; count: number }[] {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)));
  const buckets = Array.from({ length: days }, (_, i) => {
    const d = new Date(start.getTime() + i * 86_400_000);
    return { day: d.toISOString().slice(0, 10), count: 0 };
  });
  for (const date of dates) {
    const idx = Math.floor((date.getTime() - start.getTime()) / 86_400_000);
    if (idx >= 0 && idx < days) buckets[idx].count++;
  }
  return buckets;
}

export const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
