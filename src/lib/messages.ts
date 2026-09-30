/**
 * Messages automatiques aux acheteurs (fonctions pures, testées) : remerciement, expédition, demande d'évaluation.
 * Rédigés dans la langue du site eBay de la commande. Conformes aux règles eBay :
 * aucun lien, e-mail ni numéro de téléphone (retirés s'ils apparaissent dans les données), aucune contrepartie contre une évaluation.
 */
import { marketplace } from "@/lib/marketplaces";

export type MessageKind = "THANKS" | "SHIPPED" | "FEEDBACK";
type Lang = "en" | "fr" | "de" | "it" | "es";

const T: Record<Lang, Record<MessageKind, { subject: string; body: string }>> = {
  en: {
    THANKS: { subject: "Thank you for your order!", body: "Hi {name},\n\nThank you for buying \"{item}\". Your order is being prepared in our local warehouse, and we will send you the tracking number as soon as it ships.\n\nAny question? Simply reply to this message.\n\nBest regards,\n{store}" },
    SHIPPED: { subject: "Your order is on its way", body: "Hi {name},\n\nGood news: \"{item}\" has shipped with {carrier}.\nTracking number: {tracking}\n\nYou can follow the delivery from your eBay purchase history.\n\nBest regards,\n{store}" },
    FEEDBACK: { subject: "How is your purchase?", body: "Hi {name},\n\n\"{item}\" should have arrived by now. We hope you like it!\nIf anything is not right, please message us first: we will sort it out quickly.\nIf everything is fine, leaving feedback on eBay would help our small shop a lot.\n\nThank you,\n{store}" },
  },
  fr: {
    THANKS: { subject: "Merci pour votre commande !", body: "Bonjour {name},\n\nMerci pour votre achat « {item} ». Votre commande est en préparation dans notre entrepôt local et nous vous enverrons le numéro de suivi dès son expédition.\n\nUne question ? Répondez simplement à ce message.\n\nCordialement,\n{store}" },
    SHIPPED: { subject: "Votre commande est en route", body: "Bonjour {name},\n\nBonne nouvelle : « {item} » a été expédié avec {carrier}.\nNuméro de suivi : {tracking}\n\nVous pouvez suivre la livraison depuis vos achats eBay.\n\nCordialement,\n{store}" },
    FEEDBACK: { subject: "Votre achat vous plaît ?", body: "Bonjour {name},\n\n« {item} » devrait être arrivé. Nous espérons qu'il vous plaît !\nSi quelque chose ne va pas, écrivez-nous d'abord : nous réglerons ça rapidement.\nSi tout va bien, une évaluation sur eBay aiderait beaucoup notre petite boutique.\n\nMerci,\n{store}" },
  },
  de: {
    THANKS: { subject: "Vielen Dank für Ihre Bestellung!", body: "Hallo {name},\n\nvielen Dank für Ihren Kauf „{item}“. Ihre Bestellung wird in unserem lokalen Lager vorbereitet; die Sendungsnummer erhalten Sie, sobald sie versendet ist.\n\nFragen? Antworten Sie einfach auf diese Nachricht.\n\nMit freundlichen Grüßen\n{store}" },
    SHIPPED: { subject: "Ihre Bestellung ist unterwegs", body: "Hallo {name},\n\ngute Nachricht: „{item}“ wurde mit {carrier} versendet.\nSendungsnummer: {tracking}\n\nSie können die Lieferung in Ihren eBay-Käufen verfolgen.\n\nMit freundlichen Grüßen\n{store}" },
    FEEDBACK: { subject: "Sind Sie zufrieden?", body: "Hallo {name},\n\n„{item}“ sollte inzwischen angekommen sein. Wir hoffen, es gefällt Ihnen!\nFalls etwas nicht stimmt, schreiben Sie uns bitte zuerst: Wir kümmern uns schnell darum.\nWenn alles passt, würde eine Bewertung auf eBay unserem kleinen Shop sehr helfen.\n\nVielen Dank\n{store}" },
  },
  it: {
    THANKS: { subject: "Grazie per il tuo ordine!", body: "Ciao {name},\n\ngrazie per aver acquistato \"{item}\". Il tuo ordine è in preparazione nel nostro magazzino locale e ti invieremo il numero di tracciamento appena verrà spedito.\n\nHai domande? Rispondi semplicemente a questo messaggio.\n\nCordiali saluti,\n{store}" },
    SHIPPED: { subject: "Il tuo ordine è in viaggio", body: "Ciao {name},\n\nbuone notizie: \"{item}\" è stato spedito con {carrier}.\nNumero di tracciamento: {tracking}\n\nPuoi seguire la consegna dai tuoi acquisti su eBay.\n\nCordiali saluti,\n{store}" },
    FEEDBACK: { subject: "Ti piace il tuo acquisto?", body: "Ciao {name},\n\n\"{item}\" dovrebbe essere arrivato. Speriamo che ti piaccia!\nSe qualcosa non va, scrivici prima: lo risolveremo in fretta.\nSe è tutto a posto, un feedback su eBay aiuterebbe molto il nostro piccolo negozio.\n\nGrazie,\n{store}" },
  },
  es: {
    THANKS: { subject: "¡Gracias por tu pedido!", body: "Hola {name}:\n\nGracias por comprar \"{item}\". Tu pedido se está preparando en nuestro almacén local y te enviaremos el número de seguimiento en cuanto salga.\n\n¿Alguna pregunta? Responde a este mensaje.\n\nUn saludo,\n{store}" },
    SHIPPED: { subject: "Tu pedido está en camino", body: "Hola {name}:\n\nBuenas noticias: \"{item}\" se ha enviado con {carrier}.\nNúmero de seguimiento: {tracking}\n\nPuedes seguir la entrega desde tus compras de eBay.\n\nUn saludo,\n{store}" },
    FEEDBACK: { subject: "¿Te gusta tu compra?", body: "Hola {name}:\n\n\"{item}\" ya debería haber llegado. ¡Esperamos que te guste!\nSi algo no va bien, escríbenos primero: lo solucionaremos rápido.\nSi todo está bien, una valoración en eBay ayudaría mucho a nuestra pequeña tienda.\n\nGracias,\n{store}" },
  },
};

const GREETING_FALLBACK: Record<Lang, string> = { en: "there", fr: "", de: "", it: "", es: "" };

/** Retire liens, e-mails et numéros de téléphone (interdits dans les messages eBay). */
export function scrub(s: string): string {
  return s
    .replace(/https?:\/\/\S+|www\.\S+/gi, "")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export interface MessageVars {
  name?: string | null;
  item: string;
  store: string;
  tracking?: string | null;
  carrier?: string | null;
}

export function languageFor(marketId: string): Lang {
  const l = marketplace(marketId).listingLanguage as Lang;
  return l in T ? l : "en";
}

export function renderMessage(kind: MessageKind, marketId: string, v: MessageVars): { subject: string; body: string } {
  const lang = languageFor(marketId);
  const t = T[lang][kind];
  const name = scrub(v.name ?? "") || GREETING_FALLBACK[lang];
  const vars: Record<string, string> = {
    name,
    item: scrub(v.item).slice(0, 80),
    store: scrub(v.store).slice(0, 60),
    // Numéro de suivi : lettres et chiffres seulement (ne pas le prendre pour un numéro de téléphone).
    tracking: (v.tracking ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 40) || "—",
    carrier: scrub(v.carrier ?? "") || "—",
  };
  const fill = (s: string) => s.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
  // Sans prénom, « Bonjour , » devient « Bonjour, » (ligne de salutation seulement).
  const lines = fill(t.body).split("\n");
  lines[0] = lines[0].replace(/\s+([,:])$/, "$1");
  const body = lines.join("\n");
  return { subject: fill(t.subject), body: body.slice(0, 2000) };
}

export interface OrderForMessages {
  status: string;
  buyerUsername: string | null;
  createdAt: Date;
  shippedAt: Date | null;
  trackingNumber: string | null;
  msgThanksAt: Date | null;
  msgShippedAt: Date | null;
  msgFeedbackAt: Date | null;
  msgFailures: number;
}

export interface MessageSettings {
  msgThanks: boolean;
  msgShipped: boolean;
  msgFeedback: boolean;
  feedbackDelayDays: number;
}

/** Au-delà, on arrête d'essayer (acheteur injoignable, annonce terminée…). */
export const MAX_MESSAGE_FAILURES = 3;
const DAY = 86_400_000;

/** Quel message envoyer maintenant pour cette commande (au plus un par passage). */
export function nextMessage(o: OrderForMessages, s: MessageSettings, now = Date.now()): MessageKind | null {
  if (!o.buyerUsername || o.msgFailures >= MAX_MESSAGE_FAILURES) return null;
  if (o.status === "CANCELLED" || o.status === "FAILED") return null;
  // Remerciement : seulement pour une commande récente (pas pour l'historique importé).
  if (s.msgThanks && !o.msgThanksAt && now - o.createdAt.getTime() < 3 * DAY) return "THANKS";
  if (s.msgShipped && !o.msgShippedAt && o.status === "SHIPPED" && o.trackingNumber && o.shippedAt && now - o.shippedAt.getTime() < 7 * DAY) return "SHIPPED";
  if (s.msgFeedback && !o.msgFeedbackAt && o.status === "SHIPPED" && o.shippedAt) {
    const age = now - o.shippedAt.getTime();
    const delay = Math.max(1, Math.min(30, s.feedbackDelayDays)) * DAY;
    if (age >= delay && age < delay + 14 * DAY) return "FEEDBACK";
  }
  return null;
}
