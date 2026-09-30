"use client";
import { useState } from "react";
import Link from "next/link";
import type { Dict } from "@/lib/i18n";

/** Bandeau cookies : affiché tant qu'aucun choix n'a été fait (cookie « consent »). */
export default function CookieBanner({ t, initiallyVisible }: { t: Dict["cookies"]; initiallyVisible: boolean }) {
  const [visible, setVisible] = useState(initiallyVisible);
  if (!visible) return null;
  async function choose(choice: "all" | "essential") {
    setVisible(false);
    await fetch("/api/consent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ choice }) }).catch(() => {});
  }
  return (
    <div role="dialog" aria-live="polite" aria-label="Cookies" className="fixed inset-x-0 bottom-0 z-50 p-3 sm:p-4">
      <div className="mx-auto flex max-w-4xl flex-col gap-3 rounded-2xl border border-line bg-surface p-4 shadow-xl sm:flex-row sm:items-center">
        <p className="flex-1 text-sm text-fg-2">
          {t.text} <Link href="/privacy" className="font-medium text-brand-400 underline">{t.learnMore}</Link>
        </p>
        <div className="flex flex-none gap-2">
          <button type="button" onClick={() => choose("essential")} className="btn-secondary px-4 py-2 text-sm">{t.essential}</button>
          <button type="button" onClick={() => choose("all")} className="btn-primary px-4 py-2 text-sm">{t.accept}</button>
        </div>
      </div>
    </div>
  );
}
