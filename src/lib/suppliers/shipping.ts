import { MAX_DELIVERY_DAYS } from "@/lib/margin";

/**
 * Mode de livraison retenu : le moins cher parmi ceux qui livrent en ≤ `maxDays` jours (à prix égal, le plus
 * rapide). Si aucun n'est assez rapide, le plus rapide (l'appelant le refusera comme trop lent).
 * Avant, on prenait le moins cher tout court : un mode lent à 2,90 $ faisait rejeter un produit qui avait
 * aussi un mode en 3-5 jours à 3,40 $.
 */
export function pickShipping<T>(options: T[], price: (o: T) => number, days: (o: T) => number, maxDays = MAX_DELIVERY_DAYS): T | null {
  if (!options.length) return null;
  const fast = options.filter((o) => days(o) <= maxDays);
  if (fast.length) return fast.reduce((a, b) => (price(b) < price(a) || (price(b) === price(a) && days(b) < days(a)) ? b : a));
  return options.reduce((a, b) => (days(b) < days(a) || (days(b) === days(a) && price(b) < price(a)) ? b : a));
}
