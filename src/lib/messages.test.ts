import { describe, expect, it } from "vitest";
import { MAX_MESSAGE_FAILURES, nextMessage, renderMessage, scrub, type OrderForMessages } from "./messages";

const DAY = 86_400_000;
const now = Date.UTC(2026, 8, 30, 12);
const order = (over: Partial<OrderForMessages> = {}): OrderForMessages => ({
  status: "ORDERED", buyerUsername: "buyer1", createdAt: new Date(now - 3600_000), shippedAt: null, trackingNumber: null,
  msgThanksAt: null, msgShippedAt: null, msgFeedbackAt: null, msgFailures: 0, ...over,
});
const all = { msgThanks: true, msgShipped: true, msgFeedback: true, feedbackDelayDays: 7 };

describe("messages aux acheteurs", () => {
  it("texte dans la langue du site, sans lien ni e-mail ni téléphone", () => {
    const fr = renderMessage("SHIPPED", "EBAY_FR", { name: "Marie", item: "Ouvre-boîte électrique", store: "bawa-store", tracking: "LX 123 456 FR", carrier: "Colissimo" });
    expect(fr.subject).toBe("Votre commande est en route");
    expect(fr.body).toContain("Bonjour Marie,");
    expect(fr.body).toContain("Numéro de suivi : LX123456FR");
    expect(fr.body).toContain("avec Colissimo");
    const en = renderMessage("THANKS", "EBAY_US", { name: null, item: "Can opener www.cheap.com call +1 555 123 4567 mail me@x.com", store: "shop" });
    expect(en.body.startsWith("Hi there,")).toBe(true);
    expect(en.body).not.toMatch(/www|@|555/);
    const de = renderMessage("FEEDBACK", "EBAY_DE", { name: "", item: "Dosenöffner", store: "shop" });
    expect(de.body.startsWith("Hallo,")).toBe(true);
    expect(renderMessage("THANKS", "EBAY_ES", { name: "Ana", item: "x", store: "s" }).body.startsWith("Hola Ana:")).toBe(true);
    expect(scrub("see https://a.b/c now")).toBe("see now");
  });

  it("ordre : remerciement, puis suivi à l'expédition, puis évaluation après le délai", () => {
    expect(nextMessage(order(), all, now)).toBe("THANKS");
    const shipped = order({ status: "SHIPPED", msgThanksAt: new Date(), trackingNumber: "940011", shippedAt: new Date(now - DAY) });
    expect(nextMessage(shipped, all, now)).toBe("SHIPPED");
    const sent = { ...shipped, msgShippedAt: new Date() };
    expect(nextMessage(sent, all, now)).toBeNull(); // trop tôt pour l'évaluation
    expect(nextMessage({ ...sent, shippedAt: new Date(now - 8 * DAY) }, all, now)).toBe("FEEDBACK");
    expect(nextMessage({ ...sent, shippedAt: new Date(now - 40 * DAY) }, all, now)).toBeNull(); // trop vieux
  });

  it("rien si désactivé, annulé, sans acheteur, trop d'échecs, ou vieille commande importée", () => {
    expect(nextMessage(order(), { ...all, msgThanks: false }, now)).toBeNull();
    expect(nextMessage(order({ status: "CANCELLED" }), all, now)).toBeNull();
    expect(nextMessage(order({ buyerUsername: null }), all, now)).toBeNull();
    expect(nextMessage(order({ msgFailures: MAX_MESSAGE_FAILURES }), all, now)).toBeNull();
    expect(nextMessage(order({ createdAt: new Date(now - 10 * DAY) }), all, now)).toBeNull();
  });
});
