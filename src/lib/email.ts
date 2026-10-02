/**
 * Emails transactionnels (Resend : https://resend.com). Sans RESEND_API_KEY, l'email est seulement
 * écrit dans les journaux du serveur (pratique en développement) et rien n'est envoyé.
 */
import { BRAND } from "@/lib/brand";
import { fmt, getDict, isLocale, type Dict } from "@/lib/i18n";

export interface Email { to: string; subject: string; html: string; text: string }

export async function sendEmail(e: Email, idempotencyKey?: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || `${BRAND.name} <${BRAND.supportEmail}>`;
  if (!key) {
    console.info(`[email non envoyé : RESEND_API_KEY absente] à ${e.to} — ${e.subject}\n${e.text}`);
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey.slice(0, 256) } : {}),
      },
      body: JSON.stringify({ from, to: e.to, subject: e.subject, html: e.html, text: e.text, reply_to: BRAND.supportEmail }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Resend ${res.status} : ${(await res.text()).slice(0, 300)}`);
    return true;
  } catch (err) {
    console.error("Email", e.subject, err);
    return false;
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

/** Mise en page commune : titre, paragraphes, bouton, pied de page. HTML simple compatible avec les messageries. */
function layout(t: Dict["emails"], o: { heading: string; paragraphs: string[]; cta: string; url: string }): { html: string; text: string } {
  const footer = fmt(t.footer, { brand: BRAND.name });
  const html = `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:28px">
<tr><td style="font-size:18px;font-weight:bold;color:#4f46e5;padding-bottom:16px">${esc(BRAND.name)}</td></tr>
<tr><td style="font-size:20px;font-weight:bold;padding-bottom:12px">${esc(o.heading)}</td></tr>
${o.paragraphs.map((p) => `<tr><td style="font-size:15px;line-height:1.6;color:#334155;padding-bottom:12px">${esc(p)}</td></tr>`).join("")}
<tr><td style="padding:12px 0 20px"><a href="${esc(o.url)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px">${esc(o.cta)}</a></td></tr>
<tr><td style="font-size:12px;color:#64748b;border-top:1px solid #e2e8f0;padding-top:16px">${esc(footer)}<br>${esc(BRAND.company)}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [o.heading, "", ...o.paragraphs, "", `${o.cta} : ${o.url}`, "", footer, BRAND.company].join("\n");
  return { html, text };
}

const dictFor = (locale: string) => getDict(isLocale(locale) ? locale : "en").emails;

export function welcomeEmail(to: string, locale: string): Email {
  const t = dictFor(locale);
  return { to, subject: fmt(t.welcomeSubject, { brand: BRAND.name }), ...layout(t, { heading: t.welcomeHeading, paragraphs: [t.welcomeBody, t.welcomeSteps], cta: t.welcomeCta, url: `${appUrl()}/dashboard` }) };
}

export function resetEmail(to: string, locale: string, rawToken: string): Email {
  const t = dictFor(locale);
  return {
    to,
    subject: fmt(t.resetSubject, { brand: BRAND.name }),
    ...layout(t, { heading: t.resetHeading, paragraphs: [t.resetBody, t.resetIgnore], cta: t.resetCta, url: `${appUrl()}/reset-password?token=${encodeURIComponent(rawToken)}` }),
  };
}

export function paymentFailedEmail(to: string, locale: string): Email {
  const t = dictFor(locale);
  return { to, subject: t.paymentFailedSubject, ...layout(t, { heading: t.paymentFailedHeading, paragraphs: [t.paymentFailedBody], cta: t.paymentFailedCta, url: `${appUrl()}/billing` }) };
}

export function ordersAttentionEmail(to: string, locale: string, n: number): Email {
  const t = dictFor(locale);
  return { to, subject: fmt(t.attentionSubject, { n }), ...layout(t, { heading: fmt(t.attentionSubject, { n }), paragraphs: [t.attentionBody], cta: t.attentionCta, url: `${appUrl()}/orders` }) };
}

/** Nouvelles ventes (une ou plusieurs dans le même passage). */
export function newSalesEmail(to: string, locale: string, o: { sales: { title: string; total: string }[]; total: string; autoOrder: boolean }): Email {
  const t = dictFor(locale);
  const one = o.sales.length === 1;
  const subject = one ? fmt(t.saleSubject, { total: o.total }) : fmt(t.saleSubjectMany, { n: o.sales.length, total: o.total });
  const items = o.sales.slice(0, 5).map((s) => `${s.title} (${s.total})`).join(", ");
  const first = one ? fmt(t.saleBody, { item: `${o.sales[0].title} (${o.sales[0].total})` }) : fmt(t.saleBodyMany, { items });
  return { to, subject, ...layout(t, { heading: subject, paragraphs: [first, o.autoOrder ? t.saleAuto : t.saleManual], cta: t.saleCta, url: `${appUrl()}/orders` }) };
}
