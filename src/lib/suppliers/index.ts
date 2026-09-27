/**
 * Fournisseurs (CJ et AliExpress) derrière une interface commune, utilisée par les annonces,
 * les commandes automatiques et la surveillance. Tous les montants renvoyés sont en USD.
 */
import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { MAX_DELIVERY_DAYS } from "@/lib/margin";
import * as cj from "@/lib/suppliers/cj";
import * as ae from "@/lib/suppliers/aliexpress";

export type SupplierId = "CJ" | "ALIEXPRESS";

export type SupplierErrorCode = "SUPPLIER_UNSUPPORTED" | "SUPPLIER_GONE" | "SUPPLIER_RECONNECT";
export class SupplierError extends Error {
  constructor(readonly code: SupplierErrorCode, detail?: string) {
    super(detail ? `${code} : ${detail}` : code);
  }
}

type SupplierAccountRow = { id?: string; supplier: string; accessToken: string; refreshToken?: string | null; expiresAt?: Date | null };
export type Session = { supplier: "CJ"; token: string } | { supplier: "ALIEXPRESS"; cfg: ae.AeConfig; session: string };

export function aeConfig(): ae.AeConfig | null {
  const appKey = process.env.ALIEXPRESS_APP_KEY;
  const appSecret = process.env.ALIEXPRESS_APP_SECRET;
  return appKey && appSecret ? { appKey, appSecret } : null;
}

/** URL de retour après autorisation AliExpress (à déclarer comme « Callback URL » dans l'app AliExpress). */
export const aeRedirectUri = () => `${(process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "")}/api/suppliers/aliexpress/callback`;

/** Connexion au fournisseur du vendeur (jeton AliExpress renouvelé automatiquement s'il expire dans moins d'1 h). */
export async function openSession(accounts: SupplierAccountRow[], supplier: SupplierId): Promise<Session> {
  const acc = accounts.find((a) => a.supplier === supplier);
  if (!acc) throw new SupplierError("SUPPLIER_UNSUPPORTED");
  if (supplier === "CJ") return { supplier, token: decrypt(acc.accessToken) };
  const cfg = aeConfig();
  if (!cfg) throw new SupplierError("SUPPLIER_UNSUPPORTED", "ALIEXPRESS_APP_KEY");
  if (acc.expiresAt && acc.expiresAt.getTime() < Date.now() + 3600_000) {
    if (!acc.refreshToken || !acc.id) throw new SupplierError("SUPPLIER_RECONNECT");
    try {
      const t = await ae.refreshToken(cfg, decrypt(acc.refreshToken));
      await db.supplierAccount.update({
        where: { id: acc.id },
        data: { accessToken: encrypt(t.access_token), refreshToken: encrypt(t.refresh_token), expiresAt: new Date(t.expire_time) },
      });
      return { supplier, cfg, session: t.access_token };
    } catch {
      throw new SupplierError("SUPPLIER_RECONNECT");
    }
  }
  return { supplier, cfg, session: decrypt(acc.accessToken) };
}

/** Messages qui signifient « ce produit n'existe plus » (et non une panne passagère). */
const isGoneMessage = (msg: string) => /not\s*exist|not\s*found|removed|off[\s-]?shelf|offline|下架/i.test(msg);

type Cache = Map<string, Promise<unknown>>;
function cached<T>(cache: Cache | undefined, key: string, load: () => Promise<T>): Promise<T> {
  if (!cache) return load();
  if (!cache.has(key)) cache.set(key, load());
  return cache.get(key) as Promise<T>;
}

export interface ProductInfo {
  productId: string;
  variantId: string;
  title: string;
  descriptionHtml: string;
  facts: string[];
  variantLabel?: string;
  images: string[];
}

export type Quote =
  | { kind: "gone" }
  | { kind: "no_stock" }
  | { kind: "no_route"; stock: number } // plus de livraison possible
  | { kind: "ok"; stock: number; unitPrice: number; shipping: number; deliveryDaysMax: number; service: string; taxRate?: number };

/** Fiche produit + variante (titre, description, photos). */
export async function productInfo(s: Session, productId: string, variantId: string | undefined, country: string, cache?: Cache): Promise<ProductInfo | null> {
  try {
    if (s.supplier === "CJ") {
      const p = await cached(cache, `CJ:${productId}`, () => cj.getProduct(s.token, productId));
      const v = p.variants.find((x) => x.vid === variantId) ?? (variantId ? undefined : p.variants[0]);
      if (!v) return null;
      return {
        productId: p.pid,
        variantId: v.vid,
        title: p.productNameEn,
        descriptionHtml: p.description ?? "",
        facts: [p.materialNameEn ? `Material: ${p.materialNameEn}` : "", p.packingNameEn ? `Packing: ${p.packingNameEn}` : ""].filter(Boolean),
        variantLabel: v.variantKey ?? v.variantNameEn,
        images: cj.productImages(p, v),
      };
    }
    const p = await cached(cache, `AE:${productId}:${country}`, () => ae.getProduct(s.cfg, s.session, productId, country));
    const v = p.skus.find((x) => x.skuId === variantId) ?? (variantId ? undefined : p.skus[0]);
    if (!v) return null;
    return {
      productId: p.productId,
      variantId: v.skuId,
      title: p.title,
      descriptionHtml: p.descriptionHtml,
      facts: p.attributes,
      variantLabel: v.label,
      images: [...(v.image ? [v.image] : []), ...p.images],
    };
  } catch (e) {
    if (isGoneMessage(e instanceof Error ? e.message : String(e))) return null;
    throw e;
  }
}

/** Stock, prix et livraison la moins chère d'une variante vers le pays (depuis un entrepôt de ce pays). */
export async function quote(s: Session, productId: string, variantId: string, quantity: number, country: string, cache?: Cache): Promise<Quote> {
  try {
    if (s.supplier === "CJ") {
      const p = await cached(cache, `CJ:${productId}`, () => cj.getProduct(s.token, productId));
      const v = p.variants.find((x) => x.vid === variantId);
      if (!v) return { kind: "gone" };
      const stock = v.inventories?.find((i) => i.countryCode === country)?.totalInventory ?? 0;
      if (stock < quantity) return { kind: "no_stock" };
      const options = await cj.freightCalculate(s.token, v.vid, quantity, country);
      if (!options.length) return { kind: "no_route", stock };
      const best = options.reduce((a, b) => (b.logisticPrice < a.logisticPrice ? b : a));
      return { kind: "ok", stock, unitPrice: Number(v.variantSellPrice), shipping: Number(best.logisticPrice), deliveryDaysMax: cj.parseMaxDays(best.logisticAging), service: best.logisticName };
    }
    const p = await cached(cache, `AE:${productId}:${country}`, () => ae.getProduct(s.cfg, s.session, productId, country));
    const v = p.skus.find((x) => x.skuId === variantId);
    if (!v) return { kind: "gone" };
    if (v.stock < quantity) return { kind: "no_stock" };
    if (v.shipsFrom !== country) return { kind: "no_route", stock: v.stock };
    const options = await ae.shipping(s.cfg, s.session, { productId, skuId: v.skuId, quantity, country, sendFrom: country });
    if (!options.length) return { kind: "no_route", stock: v.stock };
    const best = options.reduce((a, b) => (b.amountUsd < a.amountUsd ? b : a));
    return { kind: "ok", stock: v.stock, unitPrice: v.price, shipping: best.amountUsd, deliveryDaysMax: best.deliveryDaysMax, service: best.service, taxRate: ae.AE_TAX_ESTIMATE[country] };
  } catch (e) {
    if (isGoneMessage(e instanceof Error ? e.message : String(e))) return { kind: "gone" };
    throw e;
  }
}

/** Offre livrable rapidement (≤ 8 jours) ? */
export const isFast = (q: Quote) => q.kind === "ok" && q.deliveryDaysMax <= MAX_DELIVERY_DAYS;

export interface ShipAddress {
  fullName: string;
  address: string;
  address2?: string;
  city: string;
  province: string;
  zip: string;
  phone?: string;
  country: string;
}

/** Passe la commande chez le fournisseur ; `orderNumber` est unique (protection contre les doublons). */
export async function placeSupplierOrder(
  s: Session,
  o: { orderNumber: string; address: ShipAddress; lines: { productId: string; variantId: string; quantity: number }[]; service: string },
): Promise<{ orderId: string }> {
  if (s.supplier === "CJ") {
    const r = await cj.createOrder(
      s.token,
      {
        orderNumber: o.orderNumber,
        logisticName: o.service,
        shippingCustomerName: o.address.fullName,
        shippingAddress: o.address.address,
        shippingAddress2: o.address.address2,
        shippingCity: o.address.city,
        shippingProvince: o.address.province,
        shippingZip: o.address.zip,
        shippingPhone: o.address.phone,
        products: o.lines.map((l) => ({ vid: l.variantId, quantity: l.quantity })),
      },
      o.address.country,
    );
    return { orderId: r.orderId };
  }
  // AliExpress : la commande se passe avec le code de variante (sku_attr), relu sur la fiche produit.
  const items = [];
  for (const l of o.lines) {
    const p = await ae.getProduct(s.cfg, s.session, l.productId, o.address.country);
    const v = p.skus.find((x) => x.skuId === l.variantId);
    if (!v) throw new SupplierError("SUPPLIER_GONE", l.productId);
    items.push({ productId: l.productId, skuAttr: v.skuAttr, quantity: l.quantity, service: o.service });
  }
  const r = await ae.createOrder(s.cfg, s.session, { outOrderId: o.orderNumber, address: o.address, items });
  return { orderId: r.orderIds.join(",") };
}

export type SupplierOrderState =
  | { state: "PENDING" }                // payée, pas encore expédiée
  | { state: "UNPAID" }                 // en attente de paiement chez le fournisseur (AliExpress sans paiement automatique)
  | { state: "CANCELLED" }
  | { state: "SHIPPED"; trackingNumber: string; carrierName?: string };

export async function supplierOrderState(s: Session, orderId: string): Promise<SupplierOrderState> {
  if (s.supplier === "CJ") {
    const d = await cj.getOrderDetail(s.token, orderId);
    if (d.orderStatus === "CANCELLED") return { state: "CANCELLED" };
    if (d.trackNumber) return { state: "SHIPPED", trackingNumber: d.trackNumber, carrierName: d.logisticName };
    return { state: "PENDING" };
  }
  // Plusieurs commandes AliExpress possibles (une par vendeur AliExpress) : on suit la première.
  const first = orderId.split(",")[0];
  const d = await ae.getOrder(s.cfg, s.session, first);
  if (/CANCEL|CLOSE/i.test(d.status)) return { state: "CANCELLED" };
  if (d.tracking.length) return { state: "SHIPPED", trackingNumber: d.tracking[0].number, carrierName: d.tracking[0].service };
  if (d.status === "PLACE_ORDER_SUCCESS") return { state: "UNPAID" };
  return { state: "PENDING" };
}
