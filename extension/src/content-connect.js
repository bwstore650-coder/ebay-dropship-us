/**
 * Page « Connecter l'extension » de Sellvela : signale que l'extension est installée,
 * reçoit le jeton publié par la page et le remet au service worker.
 */
(() => {
  document.documentElement.dataset.sellvelaExt = chrome.runtime.getManifest().version;
  const post = (type) => window.postMessage({ source: "sellvela-ext", type }, location.origin);
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data;
    if (!d || d.source !== "sellvela-web" || d.type !== "TOKEN" || typeof d.token !== "string") return;
    chrome.runtime.sendMessage({ type: "TOKEN", token: d.token }, (r) => {
      if (r && r.ok) post("CONNECTED");
    });
  });
  post("HELLO");
  document.addEventListener("DOMContentLoaded", () => post("HELLO"));
})();
