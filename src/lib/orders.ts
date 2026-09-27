/**
 * Règles des commandes automatiques (fonctions pures, testées) :
 * quelle commande eBay commander, à quelle adresse, avec quel transporteur pour le suivi.
 */
import type { EbayAddress, EbayOrder } from "@/lib/ebay";
import { ebayFees } from "@/lib/margin";
import { marketplace } from "@/lib/marketplaces";
import type { ShipAddress } from "@/lib/suppliers";

export interface OrderLine {
  lineItemId: string;
  sku: string;
  quantity: number;
  listingId: string;
  supplier: "CJ" | "ALIEXPRESS";
  productId: string;
  vid: string; // variante chez le fournisseur
  title: string;
}

export type OrderCheck =
  | { ok: true }
  | { ok: false; code: "NOT_PAID" | "CANCELLED_BY_BUYER" | "NO_ADDRESS" | "ALREADY_SHIPPED" };

/** Une commande ne se passe chez le fournisseur que si elle est payée, non annulée, pas encore expédiée, avec une adresse. */
export function checkOrderable(o: EbayOrder): OrderCheck {
  if (o.cancelStatus?.cancelState && o.cancelStatus.cancelState !== "NONE_REQUESTED") return { ok: false, code: "CANCELLED_BY_BUYER" };
  if (o.orderPaymentStatus && o.orderPaymentStatus !== "PAID") return { ok: false, code: "NOT_PAID" };
  if (o.orderFulfillmentStatus === "FULFILLED") return { ok: false, code: "ALREADY_SHIPPED" };
  const to = shipTo(o);
  if (!to?.fullName || !to.contactAddress?.addressLine1 || !to.contactAddress.city || !to.contactAddress.countryCode) return { ok: false, code: "NO_ADDRESS" };
  return { ok: true };
}

export function shipTo(o: EbayOrder) {
  return o.fulfillmentStartInstructions?.find((f) => f.shippingStep?.shipTo)?.shippingStep?.shipTo;
}

/** Relie les lignes de la commande eBay à nos annonces (par SKU). */
export function mapLines(
  o: EbayOrder,
  listingsBySku: Map<string, { id: string; supplierVariantId: string | null; supplierProductId: string; supplier: string }>,
): { lines: OrderLine[]; unknown: string[] } {
  const lines: OrderLine[] = [];
  const unknown: string[] = [];
  for (const li of o.lineItems) {
    const l = li.sku ? listingsBySku.get(li.sku) : undefined;
    if (!l || (l.supplier !== "CJ" && l.supplier !== "ALIEXPRESS") || !l.supplierVariantId) {
      unknown.push(li.title || li.lineItemId);
      continue;
    }
    lines.push({
      lineItemId: li.lineItemId, sku: li.sku!, quantity: li.quantity, listingId: l.id,
      supplier: l.supplier, productId: l.supplierProductId, vid: l.supplierVariantId, title: li.title,
    });
  }
  return { lines, unknown };
}

/** Adresse de livraison pour le fournisseur (la région est obligatoire : la ville la remplace si eBay n'en donne pas). */
export function shipAddress(to: { fullName: string; primaryPhone?: { phoneNumber: string }; contactAddress: EbayAddress }): ShipAddress {
  const a = to.contactAddress;
  return {
    fullName: to.fullName.slice(0, 50),
    address: a.addressLine1.slice(0, 200),
    address2: a.addressLine2?.slice(0, 200) || undefined,
    city: a.city.slice(0, 50),
    province: (a.stateOrProvince || a.city).slice(0, 50),
    zip: (a.postalCode ?? "").slice(0, 20),
    phone: to.primaryPhone?.phoneNumber?.replace(/[^\d+]/g, "").slice(0, 20) || undefined,
    country: a.countryCode,
  };
}

/** Numéro de commande envoyé au fournisseur : unique, il empêche toute double commande. */
export const supplierOrderNumber = (ebayOrderId: string) => `EB-${ebayOrderId}`.slice(0, 50);

/** Frais eBay estimés et profit réel d'une commande. */
export function orderProfit(saleTotal: number, supplierCost: number, marketId: string) {
  const fees = ebayFees(saleTotal, { market: marketplace(marketId) });
  return { fees, profit: Math.round((saleTotal - supplierCost - fees) * 100) / 100 };
}

/**
 * Code transporteur eBay (liste officielle ShippingCarrierCodeType) déduit du transporteur CJ,
 * puis du format du numéro ; « Other » sinon (accepté par eBay pour les transporteurs non listés).
 */
export function ebayCarrierCode(logisticName: string | undefined, trackingNumber: string): string {
  const n = (logisticName ?? "").toUpperCase();
  const byName: [RegExp, string][] = [
    [/\bUSPS\b/, "USPS"],
    [/\bUPS\b/, "UPS"],
    [/FEDEX/, "FedEx"],
    [/ROYAL\s*MAIL/, "RoyalMail"],
    [/AUSTRALIA\s*POST|\bAUPOST\b/, "AustraliaPost"],
    [/DEUTSCHE\s*POST/, "DeutschePost"],
    [/COLISSIMO/, "Colissimo"],
    [/LA\s*POSTE/, "LAPOSTE"],
    [/POSTE\s*ITALIANE/, "PosteItaliane"],
    [/CORREOS/, "Correos"],
    [/\bAN\s*POST\b/, "AnPost"],
    [/YANWEN/, "YANWEN"],
    [/\b4PX\b/, "FourPX"],
    [/CHINA\s*POST/, "ChinaPost"],
    [/\bDHL\b/, "DHL"],
  ];
  for (const [re, code] of byName) if (re.test(n)) return code;
  const t = trackingNumber.replace(/\s+/g, "").toUpperCase();
  if (/^1Z[0-9A-Z]{16}$/.test(t)) return "UPS";
  if (/^(9[2-5]\d{20}|9[2-5]\d{24})$/.test(t)) return "USPS";
  return "Other";
}

/** Une commande restée « en cours de commande » plus de 30 minutes doit être vérifiée à la main. */
export const STUCK_AFTER_MS = 30 * 60_000;

/** Messages du fournisseur qui signalent un solde insuffisant. */
export function isBalanceError(message: string): boolean {
  return /balance|insufficient|余额/i.test(message);
}

/** Messages du fournisseur qui signalent un numéro de commande déjà utilisé (commande déjà créée). */
export function isDuplicateError(message: string): boolean {
  return /already exist|duplicate|repeat/i.test(message);
}
