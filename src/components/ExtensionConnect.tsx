"use client";
import { useEffect, useState } from "react";
import type { Dict } from "@/lib/i18n";

/**
 * Remise du jeton à l'extension : la page le publie avec window.postMessage, le script de l'extension
 * (présent seulement sur cette page de Sellvela) le reçoit, vérifie l'origine et répond « connecté ».
 */
export default function ExtensionConnect({ t }: { t: Dict["extension"] }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [detected, setDetected] = useState<boolean | null>(null);

  useEffect(() => {
    // L'extension marque la page dès son chargement.
    const check = () => setDetected(document.documentElement.dataset.sellvelaExt !== undefined);
    check();
    const id = setTimeout(check, 800);
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== window.location.origin) return;
      const d = e.data as { source?: string; type?: string } | null;
      if (d?.source === "sellvela-ext" && d.type === "CONNECTED") setState("done");
      if (d?.source === "sellvela-ext" && d.type === "HELLO") setDetected(true);
    };
    window.addEventListener("message", onMsg);
    return () => {
      clearTimeout(id);
      window.removeEventListener("message", onMsg);
    };
  }, []);

  async function connect() {
    setState("busy");
    const ua = navigator.userAgent;
    const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : "Browser";
    const os = /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
    const res = await fetch("/api/ext/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: [browser, os].filter(Boolean).join(" · ") }) });
    const data = (await res.json().catch(() => ({}))) as { token?: string };
    if (!res.ok || !data.token) return setState("error");
    window.postMessage({ source: "sellvela-web", type: "TOKEN", token: data.token }, window.location.origin);
    // Sans réponse de l'extension après 5 s : elle n'est pas installée ou pas à jour.
    setTimeout(() => setState((s) => (s === "busy" ? "error" : s)), 5000);
  }

  return (
    <div className="card mx-auto max-w-lg space-y-4 text-center">
      <h1 className="text-xl font-semibold text-fg">{t.connectTitle}</h1>
      <p className="text-sm text-muted">{t.connectText}</p>
      {state === "done" ? (
        <p className="rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300">{t.connected}</p>
      ) : (
        <>
          <button onClick={connect} disabled={state === "busy" || detected === false} className="btn-primary w-full">
            {state === "busy" ? t.connecting : t.connectButton}
          </button>
          {(detected === false || state === "error") && <p className="text-sm text-amber-300">{t.notDetected}</p>}
        </>
      )}
    </div>
  );
}
