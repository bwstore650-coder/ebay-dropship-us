"use client";
import { useEffect, useState } from "react";
import type { Dict } from "@/lib/i18n";
import { Icon } from "@/components/icons";

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/**
 * « Installer l'app » : sur Android / Chrome / Edge, la fenêtre d'installation du navigateur ;
 * sur iPhone / iPad (Safari), les étapes Partager → Sur l'écran d'accueil. Caché une fois installée.
 */
export default function InstallApp({ t }: { t: Dict["install"] }) {
  const [prompt, setPrompt] = useState<PromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [installed, setInstalled] = useState(true);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    setInstalled(standalone);
    const ua = navigator.userAgent;
    setIos(/iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1));
    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e as PromptEvent); };
    const onInstalled = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  if (installed || (!prompt && !ios)) return null;

  async function install() {
    if (prompt) {
      await prompt.prompt();
      const r = await prompt.userChoice.catch(() => null);
      if (r?.outcome === "accepted") setInstalled(true);
      setPrompt(null);
    } else setHelp((v) => !v);
  }

  return (
    <div className="rounded-xl border border-line bg-surface-2 p-3 text-sm">
      <button type="button" onClick={install} className="flex w-full items-center gap-2 text-left font-medium text-fg">
        <img src="/icons/icon-192.png" alt="" className="h-7 w-7 rounded-lg" />
        <span className="flex-1">{t.button}</span>
        <Icon name="arrowRight" className="h-3.5 w-3.5 text-subtle" />
      </button>
      {help && (
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-muted">
          <li>{t.ios1}</li>
          <li>{t.ios2}</li>
          <li>{t.ios3}</li>
        </ol>
      )}
    </div>
  );
}
