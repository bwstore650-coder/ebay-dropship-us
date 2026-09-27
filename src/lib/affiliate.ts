/**
 * Programme d'affiliation : 30 % à vie sur chaque paiement d'un client parrainé.
 * Les commissions restent « en attente » 30 jours (garantie contre les remboursements),
 * puis deviennent « à verser ». Le versement se fait à la main (PayPal / virement) au début.
 */
import crypto from "node:crypto";

export const COMMISSION_RATE = 0.3;
export const HOLD_DAYS = 30;
export const REF_COOKIE = "ref";
export const REF_COOKIE_DAYS = 60;
export const MIN_PAYOUT_CENTS = 5000; // 50 $ minimum avant versement

export function commissionCents(amountPaidCents: number): number {
  if (!Number.isFinite(amountPaidCents) || amountPaidCents <= 0) return 0;
  return Math.floor(amountPaidCents * COMMISSION_RATE);
}

export function availableAt(paidAt: Date): Date {
  return new Date(paidAt.getTime() + HOLD_DAYS * 86_400_000);
}

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // sans caractères ambigus (0/o, 1/l/i)

export function newReferralCode(length = 8): string {
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/** Un code reçu dans l'URL : lettres/chiffres uniquement, 4 à 32 caractères. */
export function sanitizeRefCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const c = raw.trim().toLowerCase();
  return /^[a-z0-9]{4,32}$/.test(c) ? c : null;
}

export interface CommissionTotals {
  pendingCents: number;
  payableCents: number;
  paidCents: number;
}

export function totals(rows: { amountCents: number; status: string; availableAt: Date }[], now = new Date()): CommissionTotals {
  const t: CommissionTotals = { pendingCents: 0, payableCents: 0, paidCents: 0 };
  for (const r of rows) {
    if (r.status === "PAID") t.paidCents += r.amountCents;
    else if (r.status === "PAYABLE" || (r.status === "PENDING" && r.availableAt <= now)) t.payableCents += r.amountCents;
    else if (r.status === "PENDING") t.pendingCents += r.amountCents;
  }
  return t;
}
