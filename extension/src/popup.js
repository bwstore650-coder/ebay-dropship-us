/** Popup de l'extension : aperçu du compte, liste d'idées, calculateur de frais et vérificateur de marque. */
import { API_BASE } from "./config.js";
import { api, getToken, logout } from "./api.js";
import { cjProductUrl, errorKey, money, onboardingLeft, pickLocale } from "./lib.js";

const main = document.getElementById("main");
let locale = pickLocale(null, chrome.i18n.getUILanguage());
const T = (k, v) => globalThis.sellvelaT(locale, k, v);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const openSite = (path) => chrome.tabs.create({ url: `${API_BASE}${path}` });
const MARKETS = [
  ["EBAY_US", "eBay.com", "USD"], ["EBAY_CA", "eBay.ca", "CAD"], ["EBAY_GB", "eBay.co.uk", "GBP"], ["EBAY_AU", "eBay.com.au", "AUD"],
  ["EBAY_DE", "eBay.de", "EUR"], ["EBAY_FR", "eBay.fr", "EUR"], ["EBAY_IT", "eBay.it", "EUR"], ["EBAY_ES", "eBay.es", "EUR"], ["EBAY_IE", "eBay.ie", "EUR"],
];

let summary = null;
let tab = "overview";

function header() {
  const site = document.getElementById("open-site");
  site.textContent = T("openSellvela");
  site.onclick = () => openSite("/dashboard");
  const out = document.getElementById("logout");
  out.textContent = T("disconnect");
  out.onclick = async () => {
    await logout();
    await chrome.action.setBadgeText({ text: "" });
    start();
  };
}

function errorNote(code) {
  return el("div", "note err", T(errorKey(code)));
}

/* ---------- Non connecté ---------- */
function renderConnect() {
  document.getElementById("logout").hidden = true;
  main.replaceChildren();
  const box = el("div", "center");
  box.append(el("p", "muted", T("connectHint")));
  const b = el("button", "btn primary", T("connect"));
  b.onclick = () => openSite("/extension/connect");
  const c = el("button", "btn secondary", T("createAccount"));
  c.onclick = () => openSite("/register");
  box.append(b, c);
  main.append(box);
}

/* ---------- Onglets ---------- */
function renderTabs() {
  document.getElementById("logout").hidden = false;
  main.replaceChildren();
  const tabs = el("div", "tabs");
  for (const [id, key] of [["overview", "tabOverview"], ["ideas", "tabIdeas"], ["tools", "tabTools"]]) {
    const b = el("button", tab === id ? "on" : "", T(key));
    b.onclick = () => {
      tab = id;
      renderTabs();
    };
    tabs.append(b);
  }
  const body = el("div");
  main.append(tabs, body);
  if (tab === "overview") renderOverview(body);
  if (tab === "ideas") renderIdeas(body);
  if (tab === "tools") renderTools(body);
}

/* ---------- Aperçu ---------- */
function renderOverview(body) {
  const s = summary;
  if (!s) {
    body.append(el("p", "muted center", T("loading")));
    return;
  }
  // Solde CJ
  const cj = el("div", "card");
  cj.append(el("div", "label", T("cjBalance")));
  if (!s.cj.connected) {
    const a = el("button", "row", T("cjNotConnected"));
    a.onclick = () => openSite("/settings");
    cj.append(a);
  } else if (s.cj.balance === null) {
    cj.append(el("div", "muted", T("cjUnknown")));
  } else {
    cj.append(el("div", `big ${s.cj.low ? "warn" : ""}`, money(s.cj.balance, "USD", locale)));
    if (s.cj.pendingCost > 0) cj.append(el("div", "muted", T("cjPending", { amount: money(s.cj.pendingCost, "USD", locale) })));
    if (s.cj.low) cj.append(el("div", "note warn", T("cjLow")));
  }
  body.append(cj);

  // À traiter
  const todo = el("div", "card");
  const rows = [
    ["ordersToCheck", s.counts.ordersToCheck, "/orders"],
    ["paused", s.counts.pausedListings, "/listings"],
    ["returns", s.counts.openReturns, "/returns"],
  ];
  if (rows.every((r) => !r[1])) todo.append(el("div", "good", T("allGood")));
  for (const [key, n, path] of rows) {
    if (!n) continue;
    const r = el("button", "row");
    r.append(el("span", "", T(key)), el("span", `count ${key === "ordersToCheck" ? "hot" : ""}`, String(n)));
    r.onclick = () => openSite(path);
    todo.append(r);
  }
  body.append(todo);

  // Démarrage
  const left = onboardingLeft(s.onboarding);
  if (left.length) {
    const ob = el("div", "card");
    ob.append(el("div", "label", T("setupTitle")));
    const paths = { plan: "/billing", ebay: "/settings", supplier: "/settings", firstListing: "/sniper" };
    for (const k of ["plan", "ebay", "supplier", "firstListing"]) {
      const done = !left.includes(k);
      const step = el("button", "step");
      const dot = el("span", "dot");
      if (done) dot.style.cssText = "background:#10b981;border-color:#10b981";
      step.append(dot, el("span", done ? "muted" : "", T(`step_${k}`)));
      if (!done) step.onclick = () => openSite(paths[k]);
      ob.append(step);
    }
    body.append(ob);
  }

  // Parrainage
  if (s.referral.link) {
    const rf = el("div", "card");
    rf.append(el("div", "", T("referralTitle")), el("div", "muted", T("referralText")));
    const line = el("div", "copyline");
    const input = el("input");
    input.value = s.referral.link;
    input.readOnly = true;
    const b = el("button", "btn secondary", T("copy"));
    b.style.cssText = "width:auto;margin:0;white-space:nowrap";
    b.onclick = async () => {
      await navigator.clipboard.writeText(s.referral.link);
      b.textContent = T("copied");
      setTimeout(() => (b.textContent = T("copy")), 1500);
    };
    line.append(input, b);
    rf.append(line);
    rf.append(el("div", "muted", T("earnings", { pending: money(s.referral.pendingCents / 100, "USD", locale), payable: money(s.referral.payableCents / 100, "USD", locale) })));
    body.append(rf);
  }
}

/* ---------- Idées ---------- */
async function renderIdeas(body) {
  body.append(el("p", "muted center", T("loading")));
  let items;
  try {
    items = (await api("/api/ext/saved")).items;
  } catch (e) {
    body.replaceChildren(errorNote(e.code));
    if (e.code === "EXT_UNAUTHORIZED") renderConnect();
    return;
  }
  body.replaceChildren();
  if (!items.length) {
    body.append(el("p", "muted center", T("ideasEmpty")));
    return;
  }
  const card = el("div", "card");
  card.append(el("div", "label", T("ideasCount", { n: items.length })));
  for (const it of items) {
    const row = el("div", "idea");
    if (it.image && /^https:\/\//.test(it.image)) {
      const img = el("img");
      img.src = it.image;
      img.alt = "";
      img.loading = "lazy";
      row.append(img);
    } else row.append(el("span", "ph"));
    const t = el("button", "t", it.title || it.productId);
    t.title = T("openCj");
    t.onclick = () => chrome.tabs.create({ url: cjProductUrl(it.productId, it.title) });
    const x = el("button", "x", "×");
    x.title = T("remove");
    x.onclick = async () => {
      await api(`/api/ext/saved?${new URLSearchParams({ productId: it.productId })}`, { method: "DELETE" }).catch(() => {});
      renderTabs();
    };
    row.append(t, x);
    card.append(row);
  }
  body.append(card);
  const msg = el("div");
  const send = el("button", "btn primary", T("sendSniper"));
  send.onclick = async () => {
    send.disabled = true;
    send.textContent = T("sending");
    try {
      const r = await api("/api/ext/saved/sniper", { method: "POST", body: {} });
      msg.replaceChildren(el("div", "note ok", T("sent")));
      chrome.tabs.create({ url: r.url });
    } catch (e) {
      msg.replaceChildren(errorNote(e.code));
    }
    send.disabled = false;
    send.textContent = T("sendSniper");
  };
  const clear = el("button", "btn secondary", T("clearAll"));
  clear.onclick = async () => {
    if (!confirm(T("confirmClear"))) return;
    await api("/api/ext/saved?all=1", { method: "DELETE" }).catch(() => {});
    renderTabs();
  };
  body.append(send, clear, msg);
}

/* ---------- Outils ---------- */
function renderTools(body) {
  // Calculateur de frais eBay
  const fees = el("form", "card");
  fees.append(el("div", "", T("feesTitle")));
  const field = (key, name, attrs = {}) => {
    const l = el("label", "field");
    l.append(el("span", "", T(key)));
    const i = el("input");
    Object.assign(i, { name, type: "number", step: "0.01", min: "0", inputMode: "decimal", ...attrs });
    l.append(i);
    return l;
  };
  const market = el("select");
  market.name = "marketId";
  for (const [id, label] of MARKETS) {
    const o = el("option", "", label);
    o.value = id;
    if (id === (summary?.user.marketId || "EBAY_US")) o.selected = true;
    market.append(o);
  }
  const ml = el("label", "field");
  ml.append(el("span", "", T("market")), market);
  const grid = el("div", "grid2");
  grid.append(field("supplierCost", "cost", { required: true }), field("shipping", "shipping"));
  fees.append(field("price", "price", { required: true }), grid, ml);
  const go = el("button", "btn primary", T("calc"));
  go.type = "submit";
  const out = el("div");
  fees.append(go, out);
  fees.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(fees);
    try {
      const r = await api("/api/ext/fees", { method: "POST", body: { price: f.get("price"), cost: f.get("cost"), shipping: f.get("shipping"), marketId: f.get("marketId") } });
      const m = (v) => money(v, r.currency, locale);
      const dl = el("dl");
      const row = (k, v, cls = "") => dl.append(el("dt", "", k), el("dd", cls, v));
      row(T("resProfit"), m(r.profit), r.profit > 0 ? "good" : "bad");
      row(T("resMargin"), `${r.marginPct} %`);
      row(T("resFees"), m(r.fees));
      if (r.minPrice !== null) row(T("resMin", { min: summary?.user.minMarginPct ?? 30 }), m(r.minPrice));
      out.replaceChildren(dl);
    } catch (err) {
      out.replaceChildren(errorNote(err.code));
    }
  };
  body.append(fees);

  // Vérificateur de marque
  const brand = el("form", "card");
  brand.append(el("div", "", T("brandTitle")));
  const text = el("input");
  Object.assign(text, { type: "text", placeholder: T("brandPlaceholder"), maxLength: 500, required: true });
  text.style.marginTop = "8px";
  const check = el("button", "btn secondary", T("brandCheck"));
  check.type = "submit";
  const res = el("div");
  brand.append(text, check, res);
  brand.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api("/api/ext/brand", { method: "POST", body: { text: text.value } });
      res.replaceChildren(el("div", r.risky ? "note warn" : "note ok", r.risky ? T("brandRisk", { brand: r.brand }) : T("brandOk")));
    } catch (err) {
      res.replaceChildren(errorNote(err.code));
    }
  };
  body.append(brand);
}

/* ---------- Démarrage ---------- */
async function start() {
  const cached = await chrome.storage.local.get(["summary", "locale"]);
  if (cached.locale) locale = cached.locale;
  header();
  if (!(await getToken())) return renderConnect();
  summary = cached.summary || null;
  renderTabs();
  try {
    summary = await api("/api/ext/summary");
    locale = pickLocale(summary.user.locale, chrome.i18n.getUILanguage());
    await chrome.storage.local.set({ summary, locale });
    header();
    if (tab === "overview") renderTabs();
  } catch (e) {
    if (e.code === "EXT_UNAUTHORIZED") return renderConnect();
    if (!summary) main.replaceChildren(errorNote(e.code));
  }
}
start();
