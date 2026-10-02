"use client";
import { useEffect, useState } from "react";
import type { Dict } from "@/lib/i18n";

type State = "loading" | "unsupported" | "denied" | "off" | "on";

const toKey = (b64: string) => {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/** Notifications de vente sur cet appareil (service worker + abonnement Web Push). */
export default function PushToggle({ t, publicKey }: { t: Dict["settings"]; publicKey: string | null }) {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [tested, setTested] = useState(false);

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setState("unsupported");
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  async function enable() {
    if (!publicKey) return;
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setState(perm === "denied" ? "denied" : "off");
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) }));
      const res = await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
      setState(res.ok ? "on" : "off");
    } catch {
      setState("off");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
      setState("off");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setTested(false);
    await fetch("/api/push/test", { method: "POST" }).catch(() => null);
    setTested(true);
  }

  return (
    <div className="rounded-xl border border-line bg-surface-2/40 p-4">
      <p className="text-sm font-medium text-fg">{t.pushTitle}</p>
      <p className="mt-1 text-xs text-muted">{t.pushHelp}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!publicKey ? (
          <p className="text-xs text-subtle">{t.pushUnavailable}</p>
        ) : state === "unsupported" ? (
          <p className="text-xs text-subtle">{t.pushUnsupported}</p>
        ) : state === "denied" ? (
          <p className="text-xs text-amber-300">{t.pushDenied}</p>
        ) : state === "on" ? (
          <>
            <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">{t.pushOn}</span>
            <button type="button" onClick={test} className="btn-secondary px-3 py-1.5 text-xs">{t.pushTest}{tested ? " ✓" : ""}</button>
            <button type="button" onClick={disable} disabled={busy} className="px-3 py-1.5 text-xs text-muted hover:text-fg">{t.pushDisable}</button>
          </>
        ) : (
          <button type="button" onClick={enable} disabled={busy || state === "loading"} className="btn-primary px-4 py-2 text-sm">{t.pushEnable}</button>
        )}
      </div>
    </div>
  );
}
