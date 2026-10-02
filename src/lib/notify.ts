/**
 * Alertes de vente : email (si activé) + notification sur les appareils abonnés (Web Push).
 * Le push n'est actif que si les clés VAPID sont configurées (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).
 */
import webpush from "web-push";
import { db } from "@/lib/db";
import { newSalesEmail, sendEmail } from "@/lib/email";
import { fmt, getDict, isLocale } from "@/lib/i18n";

export const vapidPublicKey = () => process.env.VAPID_PUBLIC_KEY || null;
export const pushConfigured = () => Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

let configured = false;
function setup() {
  if (configured) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:support@sellvela.com", process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  configured = true;
}

export interface PushPayload { title: string; body: string; url: string }

/** Envoie une notification à tous les appareils du vendeur ; les abonnements expirés sont supprimés. */
export async function pushToUser(userId: string, payload: PushPayload): Promise<number> {
  if (!pushConfigured()) return 0;
  setup();
  const subs = await db.pushSubscription.findMany({ where: { userId } });
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600 });
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await db.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
      else console.error("Push", s.id, e);
    }
  }
  return sent;
}

const money = (v: number, currency: string, locale: string) => {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(v);
  } catch {
    return `${v.toFixed(2)} ${currency}`;
  }
};

/** Nouvelles ventes importées d'eBay : un email et une notification pour le lot. */
export async function notifyNewSales(
  user: { id: string; email: string; locale: string; notifySales: boolean; autoOrder: boolean },
  sales: { title: string; total: number; currency: string }[],
): Promise<void> {
  if (!sales.length) return;
  const loc = isLocale(user.locale) ? user.locale : "en";
  const tag = { en: "en-US", fr: "fr-FR", de: "de-DE", es: "es-ES", it: "it-IT" }[loc];
  const byCur = new Map<string, number>();
  for (const s of sales) byCur.set(s.currency, (byCur.get(s.currency) ?? 0) + s.total);
  const total = [...byCur.entries()].map(([c, v]) => money(v, c, tag)).join(" + ");
  const lines = sales.map((s) => ({ title: s.title.slice(0, 80), total: money(s.total, s.currency, tag) }));
  const t = getDict(loc).emails;
  await Promise.all([
    user.notifySales ? sendEmail(newSalesEmail(user.email, user.locale, { sales: lines, total, autoOrder: user.autoOrder })) : Promise.resolve(false),
    pushToUser(user.id, {
      title: sales.length === 1 ? t.pushTitle : fmt(t.pushTitleMany, { n: sales.length }),
      body: sales.length === 1 ? `${lines[0].title} · ${lines[0].total}` : total,
      url: "/orders",
    }).catch((e) => console.error("Push ventes", e)),
  ]);
}
