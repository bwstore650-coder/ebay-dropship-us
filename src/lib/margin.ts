/**
 * Calcul de marge eBay US — le cœur de l'outil.
 * Frais eBay (catégories standard, 2026) : 13,6 % du total de la vente
 * + frais fixe par commande (0,40 $ au-dessus de 10 $, 0,30 $ sinon).
 */

export const EBAY_FVF_RATE = 0.136;
export const MAX_DELIVERY_DAYS = 8;
export const DEFAULT_MIN_MARGIN_PCT = 30;

export function perOrderFee(saleTotal: number): number {
  return saleTotal > 10 ? 0.4 : 0.3;
}

export interface FeeOptions {
  fvfRate?: number;       // commission eBay (0.136 par défaut)
  promotedRate?: number;  // publicité « Promoted Listings » (0 par défaut)
}

export function ebayFees(saleTotal: number, opts: FeeOptions = {}): number {
  const fvf = opts.fvfRate ?? EBAY_FVF_RATE;
  const promo = opts.promotedRate ?? 0;
  return round2(saleTotal * (fvf + promo) + perOrderFee(saleTotal));
}

export interface MarginInput extends FeeOptions {
  saleTotal: number;        // prix payé par l'acheteur eBay (produit + livraison facturée)
  supplierCost: number;     // prix produit chez le fournisseur
  supplierShipping?: number;// livraison fournisseur vers le client
  supplierTaxRate?: number; // taxe de vente facturée par le fournisseur (ex. 0.07)
}

export interface MarginResult {
  saleTotal: number;
  landedCost: number;
  fees: number;
  profit: number;
  marginPct: number;
}

export function landedCost(i: Pick<MarginInput, "supplierCost" | "supplierShipping" | "supplierTaxRate">): number {
  const base = i.supplierCost + (i.supplierShipping ?? 0);
  return round2(base * (1 + (i.supplierTaxRate ?? 0)));
}

export function computeMargin(i: MarginInput): MarginResult {
  const cost = landedCost(i);
  const fees = ebayFees(i.saleTotal, i);
  const profit = round2(i.saleTotal - cost - fees);
  const marginPct = i.saleTotal > 0 ? round1((profit / i.saleTotal) * 100) : 0;
  return { saleTotal: i.saleTotal, landedCost: cost, fees, profit, marginPct };
}

/** Prix de vente minimum pour atteindre la marge visée : P = (C + fixe) / (1 - taux - marge). */
export function priceForTargetMargin(cost: number, targetPct: number, opts: FeeOptions = {}): number {
  const rate = (opts.fvfRate ?? EBAY_FVF_RATE) + (opts.promotedRate ?? 0);
  const m = targetPct / 100;
  const denom = 1 - rate - m;
  if (denom <= 0) throw new Error("Marge visée impossible avec ces frais");
  let p = (cost + 0.4) / denom;
  if (p <= 10) p = (cost + 0.3) / denom;
  return Math.ceil(p * 100) / 100;
}

export interface SupplierOffer {
  supplier: "ALIEXPRESS" | "CJ";
  productId: string;
  variantId?: string;
  title: string;
  price: number;
  shipping: number;
  taxRate?: number;
  stockUs: number;
  deliveryDaysMax: number;
  url?: string;
}

/** Meilleure offre : en stock aux US, livrée en ≤ 8 jours, coût livré le plus bas. */
export function pickBestOffer(offers: SupplierOffer[]): SupplierOffer | null {
  const ok = offers.filter((o) => o.stockUs > 0 && o.deliveryDaysMax <= MAX_DELIVERY_DAYS);
  if (!ok.length) return null;
  return ok.reduce((best, o) =>
    landedCost({ supplierCost: o.price, supplierShipping: o.shipping, supplierTaxRate: o.taxRate }) <
    landedCost({ supplierCost: best.price, supplierShipping: best.shipping, supplierTaxRate: best.taxRate })
      ? o
      : best,
  );
}

export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : round2((v[mid - 1] + v[mid]) / 2);
}

/**
 * Médiane pondérée par les ventes : chaque annonce compte autant de fois qu'elle a vendu d'unités.
 * Donne le prix auquel le marché achète vraiment, pas le prix affiché par les annonces qui ne vendent pas.
 */
export function weightedMedian(points: { price: number; weight: number }[]): number | null {
  const v = points.filter((p) => p.price > 0 && p.weight > 0).sort((a, b) => a.price - b.price);
  const total = v.reduce((s, p) => s + p.weight, 0);
  if (!total) return null;
  let acc = 0;
  for (const p of v) {
    acc += p.weight;
    if (acc >= total / 2) return round2(p.price);
  }
  return null;
}

export type Verdict = "RENTABLE" | "TROP_FAIBLE" | "PAS_DE_FOURNISSEUR" | "PAS_DE_PRIX";

export interface Evaluation {
  verdict: Verdict;
  marketPrice: number | null;
  best: SupplierOffer | null;
  margin: MarginResult | null;
  minPriceForTarget: number | null;
}

/** Évalue un produit : prix de marché eBay (médiane) vs meilleure offre fournisseur. */
export function evaluateProduct(
  ebayPrices: number[],
  offers: SupplierOffer[],
  minMarginPct = DEFAULT_MIN_MARGIN_PCT,
  opts: FeeOptions = {},
): Evaluation {
  const marketPrice = median(ebayPrices);
  const best = pickBestOffer(offers);
  if (marketPrice === null) return { verdict: "PAS_DE_PRIX", marketPrice, best, margin: null, minPriceForTarget: null };
  if (!best) return { verdict: "PAS_DE_FOURNISSEUR", marketPrice, best, margin: null, minPriceForTarget: null };
  const margin = computeMargin({
    ...opts,
    saleTotal: marketPrice,
    supplierCost: best.price,
    supplierShipping: best.shipping,
    supplierTaxRate: best.taxRate,
  });
  const cost = landedCost({ supplierCost: best.price, supplierShipping: best.shipping, supplierTaxRate: best.taxRate });
  return {
    verdict: margin.marginPct >= minMarginPct ? "RENTABLE" : "TROP_FAIBLE",
    marketPrice,
    best,
    margin,
    minPriceForTarget: priceForTargetMargin(cost, minMarginPct, opts),
  };
}

function round2(n: number) { return Math.round(n * 100) / 100; }
function round1(n: number) { return Math.round(n * 10) / 10; }
