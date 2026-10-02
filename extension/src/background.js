/**
 * Service worker : vérification régulière du compte (badge, notifications de ventes, commandes bloquées,
 * solde CJ bas), menu « Vérifier le risque de marque » et relais des pages CJ vers Sellvela.
 */
import "./i18n.js";
import { API_BASE, LOW_BALANCE_REMIND_MS, POLL_MINUTES } from "./config.js";
import { api } from "./api.js";
import { badgeFor, isToken, money, newEvents, pickLocale, safeUrl, shouldWarnLowBalance } from "./lib.js";

const ICON = "icons/icon128.png";

async function locale() {
  const { locale } = await chrome.storage.local.get("locale");
  return locale || pickLocale(null, chrome.i18n.getUILanguage());
}
const T = async (key, vars) => globalThis.sellvelaT(await locale(), key, vars);

async function setup() {
  const title = await T("ctxBrand");
  chrome.contextMenus.removeAll(() => chrome.contextMenus.create({ id: "brand", title, contexts: ["selection"] }));
  chrome.alarms.create("poll", { periodInMinutes: POLL_MINUTES, delayInMinutes: 0.1 });
}
chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);

async function setBadge(summary) {
  const b = badgeFor(summary);
  await chrome.action.setBadgeText({ text: b.text });
  if (b.text) await chrome.action.setBadgeBackgroundColor({ color: b.color });
}

/** Lit le résumé du compte, met à jour le badge et prévient des nouveautés. */
async function poll() {
  const st = await chrome.storage.local.get(["token", "since", "seen", "lowWarnedAt"]);
  if (!st.token) return setBadge(null);
  let s;
  try {
    s = await api(`/api/ext/summary${st.since ? `?since=${encodeURIComponent(st.since)}` : ""}`);
  } catch (e) {
    if (e.code === "EXT_UNAUTHORIZED") await setBadge(null);
    return;
  }
  const loc = pickLocale(s.user?.locale, chrome.i18n.getUILanguage());
  const t = (k, v) => globalThis.sellvelaT(loc, k, v);
  // Premier passage : on retient les événements existants sans notifier (pas d'avalanche à la connexion).
  const { fresh, ids } = st.since ? newEvents(s.events, st.seen) : { fresh: [], ids: (s.events ?? []).map((e) => e.id) };
  for (const e of fresh.slice(0, 5)) {
    const sale = e.kind === "SALE";
    chrome.notifications.create(e.id, {
      type: "basic",
      iconUrl: ICON,
      title: t(sale ? "nSale" : "nBlocked"),
      message: sale ? t("nSaleBody", { title: e.title, amount: money(e.amount, e.currency, loc) }) : t("nBlockedBody", { title: e.title }),
      priority: sale ? 0 : 2,
    });
  }
  const now = Date.now();
  const warn = shouldWarnLowBalance(s, st.lowWarnedAt, now, LOW_BALANCE_REMIND_MS);
  if (warn) {
    chrome.notifications.create(`low:${now}`, {
      type: "basic", iconUrl: ICON, title: t("nLowTitle"), message: t("nLowBody", { balance: money(s.cj.balance, "USD", loc) }), priority: 2,
    });
  }
  await chrome.storage.local.set({ summary: s, since: s.now, seen: ids, locale: loc, ...(warn ? { lowWarnedAt: now } : {}), ...(s.cj?.low ? {} : { lowWarnedAt: null }) });
  await setBadge(s);
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "poll") poll();
});

chrome.notifications.onClicked.addListener((id) => {
  const url = id.startsWith("low:") ? "https://cjdropshipping.com/" : `${API_BASE}/orders`;
  chrome.tabs.create({ url });
  chrome.notifications.clear(id);
});

/* Clic droit sur un texte sélectionné : la marque est-elle protégée ? */
chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== "brand" || !info.selectionText) return;
  const notify = (title, message = "") => chrome.notifications.create(`brand:${Date.now()}`, { type: "basic", iconUrl: ICON, title, message });
  try {
    const r = await api("/api/ext/brand", { method: "POST", body: { text: info.selectionText } });
    notify(r.risky ? await T("nBrandRisk", { brand: r.brand }) : await T("nBrandOk"), info.selectionText.slice(0, 120));
  } catch (e) {
    notify(e.code === "EXT_UNAUTHORIZED" ? await T("nNeedConnect") : await T("errGeneric"));
  }
});

/* Messages des scripts de page (CJdropshipping, page de connexion Sellvela). */
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !msg || typeof msg.type !== "string") return false;
  const ok = (data) => reply({ ok: true, data });
  const fail = (e) => reply({ ok: false, error: e?.code || "UPSTREAM" });
  (async () => {
    switch (msg.type) {
      case "TOKEN": {
        // Accepté seulement depuis la page « Connecter l'extension » de Sellvela.
        const from = sender.url || "";
        if (!from.startsWith(`${API_BASE}/extension/connect`) || !isToken(msg.token)) return fail({ code: "INVALID_INPUT" });
        await chrome.storage.local.set({ token: msg.token, since: null, seen: [] });
        await poll();
        return ok(true);
      }
      case "STATUS": {
        const { token } = await chrome.storage.local.get("token");
        return ok({ connected: Boolean(token), locale: await locale() });
      }
      case "ANALYZE":
        return ok(await api("/api/ext/analyze", { method: "POST", body: { productId: msg.productId } }));
      case "AI_TITLES":
        return ok(await api("/api/ext/ai-titles", { method: "POST", body: { productId: msg.productId } }));
      case "EBAY_ITEM":
        return ok(await api("/api/ext/ebay-item", { method: "POST", body: { itemId: msg.itemId, host: msg.host } }));
      case "SAVE":
        return ok(await api("/api/ext/saved", { method: "POST", body: { productId: msg.productId, title: msg.title, image: msg.image } }));
      case "OPEN": {
        const url = typeof msg.path === "string" && /^\/[a-z0-9/_-]*$/i.test(msg.path) ? `${API_BASE}${msg.path}` : safeUrl(msg.url, API_BASE);
        if (url) await chrome.tabs.create({ url });
        return ok(Boolean(url));
      }
      default:
        return fail({ code: "INVALID_INPUT" });
    }
  })().catch(fail);
  return true; // réponse asynchrone
});
