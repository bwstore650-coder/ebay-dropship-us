/**
 * Conversion de devises pour comparer un coût fournisseur (USD) à un prix eBay local (CAD, GBP, AUD, EUR).
 * Taux : Banque centrale européenne via l'API gratuite Frankfurter v1 (https://frankfurter.dev/v1/), cache 12 h.
 * Une marge de sécurité de 2 % est ajoutée sur le coût converti (frais de change de la carte).
 */
import type { SupplierOffer } from "@/lib/margin";

export type Rates = Record<string, number>; // 1 USD = rates[devise]
export const FX_SAFETY = 0.02;

let cache: { rates: Rates; at: number } | null = null;

export async function getUsdRates(): Promise<Rates> {
  if (cache && Date.now() - cache.at < 12 * 3600_000) return cache.rates;
  const res = await fetch("https://api.frankfurter.dev/v1/latest?base=USD&symbols=CAD,GBP,AUD,EUR");
  if (!res.ok) throw new Error(`Taux de change indisponibles (${res.status})`);
  const data = (await res.json()) as { rates: Rates };
  cache = { rates: { USD: 1, ...data.rates }, at: Date.now() };
  return cache.rates;
}

export function convertFromUsd(amountUsd: number, currency: string, rates: Rates, safety = FX_SAFETY): number {
  if (currency === "USD") return amountUsd;
  const rate = rates[currency];
  if (!rate || rate <= 0) throw new Error(`Taux USD→${currency} manquant`);
  return Math.round(amountUsd * rate * (1 + safety) * 100) / 100;
}

/** Convertit le prix et la livraison d'offres en USD vers la devise du pays. */
export function offersToCurrency(offers: SupplierOffer[], currency: string, rates: Rates): SupplierOffer[] {
  if (currency === "USD") return offers;
  return offers.map((o) => ({
    ...o,
    price: convertFromUsd(o.price, currency, rates),
    shipping: convertFromUsd(o.shipping, currency, rates),
  }));
}
