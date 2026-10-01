/**
 * Pages produit CJdropshipping : petit panneau Sellvela (profit eBay, stock US, risque de marque,
 * « Garder dans mes idées », « Créer l'annonce »). Lit seulement l'identifiant du produit dans l'adresse
 * (et le titre/l'image de la page pour la liste d'idées) ; toutes les données viennent de Sellvela.
 */
(async () => {
  if (window.top !== window) return; // pas dans les cadres intégrés
  const lib = await import(chrome.runtime.getURL("src/lib.js"));
  const send = (msg) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (r) => resolve(r || { ok: false, error: "UPSTREAM" }));
      } catch {
        resolve({ ok: false, error: "UPSTREAM" }); // extension mise à jour : la page doit être rechargée
      }
    });

  let locale = "en";
  let connected = false;
  const T = (k, v) => globalThis.sellvelaT(locale, k, v);

  /* ---------- Interface (isolée dans un shadow DOM) ---------- */
  const host = document.createElement("div");
  host.id = "sellvela-ext-root";
  host.style.cssText = "all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483646;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
    *{box-sizing:border-box;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
    .pill{display:flex;align-items:center;gap:8px;border:0;cursor:pointer;border-radius:999px;padding:10px 14px 10px 10px;
      background:linear-gradient(#7c78fa,#5b4cf0);color:#fff;font-size:13px;font-weight:600;box-shadow:0 8px 24px -8px rgba(91,76,240,.8)}
    .logo{display:grid;place-items:center;width:22px;height:22px;border-radius:6px;background:rgba(255,255,255,.2);font-weight:800}
    .panel{width:340px;max-height:80vh;overflow:auto;border-radius:16px;background:#14141c;color:#e7e7ee;border:1px solid #2a2a38;
      box-shadow:0 20px 50px -12px rgba(0,0,0,.6);padding:14px;font-size:13px;line-height:1.45}
    .head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
    .brand{display:flex;align-items:center;gap:8px;font-weight:700}
    .brand .logo{background:linear-gradient(#7c78fa,#5b4cf0)}
    .x{background:none;border:0;color:#9a9ab0;font-size:18px;cursor:pointer;padding:2px 6px}
    .btn{width:100%;border:0;cursor:pointer;border-radius:10px;padding:10px 12px;font-weight:600;font-size:13px;margin-top:8px}
    .primary{background:linear-gradient(#7c78fa,#5b4cf0);color:#fff}
    .secondary{background:#22222e;color:#e7e7ee;border:1px solid #33334a}
    .btn:disabled{opacity:.6;cursor:default}
    .profit{font-size:26px;font-weight:700;letter-spacing:-.02em}
    .good{color:#6ee7b7}.bad{color:#fca5a5}.warn{color:#fcd34d}.muted{color:#9a9ab0}
    .verdict{display:inline-block;margin-top:4px;padding:3px 8px;border-radius:999px;font-size:12px;font-weight:600}
    .verdict.good{background:rgba(16,185,129,.12)}.verdict.bad{background:rgba(239,68,68,.12)}
    dl{display:grid;grid-template-columns:1fr auto;gap:6px 12px;margin:12px 0 0}
    dt{color:#9a9ab0}dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}
    .alert{margin-top:10px;padding:8px 10px;border-radius:10px;background:rgba(245,158,11,.12);color:#fcd34d;font-size:12px}
    .err{margin-top:10px;padding:8px 10px;border-radius:10px;background:rgba(239,68,68,.12);color:#fca5a5;font-size:12px}
    .small{font-size:11px;margin-top:8px}
    a.link{color:#a5a3ff;text-decoration:underline;cursor:pointer}
  </style><div id="app"></div>`;
  const app = root.getElementById("app");
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  let open = false;
  let pid = null;
  let analysis = null;
  let error = null;
  let busy = false;
  let saved = false;

  function pageProduct() {
    const meta = (p) => document.querySelector(`meta[property="${p}"]`)?.getAttribute("content") || "";
    const image = meta("og:image");
    return { title: (meta("og:title") || document.title || "").trim().slice(0, 300), image: /^https:\/\//.test(image) ? image : null };
  }

  /** Ouverture par le service worker : seulement des pages Sellvela ou CJ (vérifié là-bas). */
  const openUrl = (url) => send({ type: "OPEN", url });
  const openPath = (path) => send({ type: "OPEN", path });

  function render() {
    app.replaceChildren();
    if (!pid) return;
    if (!open) {
      const pill = el("button", "pill");
      pill.append(el("span", "logo", "S"), el("span", "", T("analyze")));
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
      const b = el("button", "btn primary", T("connect"));
      b.onclick = () => openPath("/extension/connect");
      panel.append(b);
      app.append(panel);
      return;
    }

    if (analysis) panel.append(renderAnalysis(analysis));
    if (error) {
      const box = el("div", "err", T(lib.errorKey(error)));
      const fix = { PLAN_REQUIRED: ["choosePlan", "/billing"], CJ_REQUIRED: ["openSettings", "/settings"], EXT_UNAUTHORIZED: ["connect", "/extension/connect"] }[error];
      if (fix) {
        box.append(document.createTextNode(" "));
        const a = el("a", "link", T(fix[0]));
        a.onclick = () => openPath(fix[1]);
        box.append(a);
      }
      panel.append(box);
    }

    if (!analysis) {
      const b = el("button", "btn primary", busy ? T("analyzing") : T("analyze"));
      b.disabled = busy;
      b.onclick = analyze;
      panel.append(b);
    } else if (analysis.status === "PROFITABLE" && !analysis.vero) {
      const b = el("button", "btn primary", T("createListing"));
      b.onclick = () => openUrl(analysis.createUrl);
      panel.append(b);
    }
    const s = el("button", "btn secondary", saved ? T("saved") : T("save"));
    s.disabled = saved;
    s.onclick = save;
    panel.append(s);
    app.append(panel);
  }

  function renderAnalysis(a) {
    const box = el("div");
    const cur = a.currency || "USD";
    const m = (v) => lib.money(v, cur, locale);
    box.append(el("div", "muted", T("profitLabel")));
    const profit = el("div", `profit ${a.profit !== null && a.profit > 0 ? "good" : "bad"}`, a.profit === null ? "—" : `${a.profit > 0 ? "+" : ""}${m(a.profit)}`);
    box.append(profit);
    if (a.marginPct !== null) box.append(el("div", "muted", T("marginLabel", { pct: a.marginPct })));
    const ok = a.status === "PROFITABLE";
    box.append(el("span", `verdict ${ok ? "good" : "bad"}`, ok ? T("profitable", { min: a.minMarginPct }) : `${T("notProfitable")}${a.reason ? ` — ${T(`r_${a.reason}`)}` : ""}`));
    const dl = el("dl");
    const row = (k, v) => dl.append(el("dt", "", k), el("dd", "", v));
    row(T("ebayPrice"), m(a.marketPrice));
    row(T("fees"), a.fees === null ? "—" : `− ${m(a.fees)}`);
    row(T("cost"), a.cost === null ? "—" : `− ${m(a.cost)}`);
    if (a.minPrice !== null) row(T("minPrice", { min: a.minMarginPct }), m(a.minPrice));
    row(T("stock"), a.stock === null ? "—" : String(a.stock));
    row(T("delivery"), a.deliveryDaysMax ? T("days", { n: a.deliveryDaysMax }) : "—");
    box.append(dl);
    if (a.vero) box.append(el("div", "alert", T("brandWarn", { brand: a.vero })));
    const when = new Date(a.analyzedAt);
    box.append(el("div", "muted small", T("analyzedAt", { time: when.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) })));
    return box;
  }

  async function analyze() {
    busy = true;
    error = null;
    render();
    const r = await send({ type: "ANALYZE", productId: pid });
    busy = false;
    if (r.ok) analysis = r.data;
    else error = r.error;
    if (error === "EXT_UNAUTHORIZED") connected = false;
    render();
  }

  async function save() {
    const p = pageProduct();
    const r = await send({ type: "SAVE", productId: pid, title: analysis?.title || p.title, image: analysis?.image || p.image });
    if (r.ok) saved = true;
    else error = r.error;
    render();
  }

  /* ---------- Démarrage + navigation interne du site (pages sans rechargement) ---------- */
  async function refresh() {
    const next = lib.cjProductIdFromUrl(location.href);
    if (next === pid) return;
    pid = next;
    analysis = null;
    error = null;
    saved = false;
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
