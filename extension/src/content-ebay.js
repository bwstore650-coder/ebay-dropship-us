/**
 * Fiches produit eBay (TEMPORAIRE, pour les tests) : ventes estimées de l'annonce ouverte, par mois,
 * et le marché du même produit. Lit seulement le numéro de l'annonce dans l'adresse de la page ;
 * toutes les données viennent de l'API officielle d'eBay, par Sellvela. Rien n'est envoyé sans clic.
 */
(async () => {
  if (window.top !== window) return;
  const lib = await import(chrome.runtime.getURL("src/lib.js"));
  const send = (msg) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (r) => resolve(r || { ok: false, error: "UPSTREAM" }));
      } catch {
        resolve({ ok: false, error: "UPSTREAM" });
      }
    });

  let locale = "en";
  let connected = false;
  const T = (k, v) => globalThis.sellvelaT(locale, k, v);

  const host = document.createElement("div");
  host.id = "sellvela-ebay-root";
  host.style.cssText = "all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483646;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
    *{box-sizing:border-box;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
    .pill{display:flex;align-items:center;gap:8px;border:0;cursor:pointer;border-radius:999px;padding:10px 14px 10px 10px;
      background:linear-gradient(#7c78fa,#5b4cf0);color:#fff;font-size:13px;font-weight:600;box-shadow:0 8px 24px -8px rgba(91,76,240,.8)}
    .logo{display:grid;place-items:center;width:22px;height:22px;border-radius:6px;background:rgba(255,255,255,.2);font-weight:800}
    .panel{width:320px;max-height:80vh;overflow:auto;border-radius:16px;background:#14141c;color:#e7e7ee;border:1px solid #2a2a38;
      box-shadow:0 20px 50px -12px rgba(0,0,0,.6);padding:14px;font-size:13px;line-height:1.45}
    .head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
    .brand{display:flex;align-items:center;gap:8px;font-weight:700}
    .brand .logo{background:linear-gradient(#7c78fa,#5b4cf0)}
    .x{background:none;border:0;color:#9a9ab0;font-size:18px;cursor:pointer;padding:2px 6px}
    .btn{width:100%;border:0;cursor:pointer;border-radius:10px;padding:10px 12px;font-weight:600;font-size:13px;margin-top:8px;background:linear-gradient(#7c78fa,#5b4cf0);color:#fff}
    .btn:disabled{opacity:.6;cursor:default}
    .big{font-size:26px;font-weight:700;letter-spacing:-.02em;color:#fcd34d}
    .muted{color:#9a9ab0}.small{font-size:11px;margin-top:8px}
    h4{margin:14px 0 0;font-size:12px;color:#c7c7d6;text-transform:uppercase;letter-spacing:.04em}
    dl{display:grid;grid-template-columns:1fr auto;gap:6px 12px;margin:8px 0 0}
    dt{color:#9a9ab0}dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}
    .err{margin-top:10px;padding:8px 10px;border-radius:10px;background:rgba(239,68,68,.12);color:#fca5a5;font-size:12px}
    a.link{color:#a5a3ff;text-decoration:underline;cursor:pointer}
  </style><div id="app"></div>`;
  const app = root.getElementById("app");
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  let item = null; // { itemId, host }
  let open = false;
  let data = null;
  let error = null;
  let busy = false;
  const openPath = (path) => send({ type: "OPEN", path });
  const num = (v) => (v === null || v === undefined ? "—" : Number(v).toLocaleString(locale, { maximumFractionDigits: 1 }));

  function render() {
    app.replaceChildren();
    if (!item) return;
    if (!open) {
      const pill = el("button", "pill");
      pill.append(el("span", "logo", "S"), el("span", "", T("ebaySales")));
      pill.onclick = () => {
        open = true;
        render();
      };
      app.append(pill);
      return;
    }
    const panel = el("div", "panel");
    const head = el("div", "head");
    const brand = el("div", "brand");
    brand.append(el("span", "logo", "S"), el("span", "", "Sellvela"));
    const close = el("button", "x", "×");
    close.title = T("hide");
    close.onclick = () => {
      open = false;
      render();
    };
    head.append(brand, close);
    panel.append(head);

    if (!connected) {
      panel.append(el("p", "muted", T("connectHint")));
      const b = el("button", "btn", T("connect"));
      b.onclick = () => openPath("/extension/connect");
      panel.append(b);
      app.append(panel);
      return;
    }

    if (data) {
      const cur = data.currency || "USD";
      panel.append(el("div", "muted", T("ebayMonthly")));
      panel.append(el("div", "big", data.monthly === null ? "—" : T("perMonthShort", { n: num(data.monthly) })));
      const dl = el("dl");
      const row = (k, v) => dl.append(el("dt", "", k), el("dd", "", v));
      row(T("ebaySoldTotal"), num(data.sold));
      row(T("ebayOnline"), data.monthsOnline === null ? "—" : T("monthsN", { n: data.monthsOnline }));
      row(T("ebayPriceThis"), lib.money(data.price, cur, locale));
      if (data.variations > 1) row(T("ebayVariations"), String(data.variations));
      panel.append(dl);
      if (data.market) {
        panel.append(el("h4", "", T("ebaySameProduct")));
        const m = el("dl");
        const r2 = (k, v) => m.append(el("dt", "", k), el("dd", "", v));
        r2(T("ebayCompetitors"), num(data.market.competitors));
        r2(T("ebayMarketMonthly"), data.market.monthlySales === null ? "—" : T("perMonthShort", { n: num(data.market.monthlySales) }));
        r2(T("ebayMarketPrice"), data.market.priceMedian === null ? "—" : lib.money(data.market.priceMedian, cur, locale));
        panel.append(m);
        panel.append(el("div", "muted small", data.market.method === "IMAGE" ? T("ebayByImage") : T("ebayByKeyword")));
      }
      panel.append(el("div", "muted small", T("ebayEstimateNote")));
    }
    if (error) {
      const box = el("div", "err", T(lib.errorKey(error)));
      const fix = { PLAN_REQUIRED: ["choosePlan", "/billing"], EXT_UNAUTHORIZED: ["connect", "/extension/connect"] }[error];
      if (fix) {
        box.append(document.createTextNode(" "));
        const a = el("a", "link", T(fix[0]));
        a.onclick = () => openPath(fix[1]);
        box.append(a);
      }
      panel.append(box);
    }
    if (!data) {
      const b = el("button", "btn", busy ? T("analyzing") : T("ebayCheck"));
      b.disabled = busy;
      b.onclick = check;
      panel.append(b);
    }
    app.append(panel);
  }

  async function check() {
    busy = true;
    error = null;
    render();
    const r = await send({ type: "EBAY_ITEM", itemId: item.itemId, host: item.host });
    busy = false;
    if (r.ok) data = r.data;
    else error = r.error;
    if (error === "EXT_UNAUTHORIZED") connected = false;
    render();
  }

  async function refresh() {
    const next = lib.ebayItemFromUrl(location.href);
    if ((next && next.itemId) === (item && item.itemId)) return;
    item = next;
    data = null;
    error = null;
    busy = false;
    render();
  }
  const st = await send({ type: "STATUS" });
  if (st.ok) {
    connected = st.data.connected;
    locale = st.data.locale || "en";
  }
  document.documentElement.append(host);
  await refresh();
  setInterval(refresh, 1000);
})();
