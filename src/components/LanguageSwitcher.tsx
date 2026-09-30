"use client";
import { useRouter } from "next/navigation";
import { LOCALE_COOKIE, LOCALE_NAMES, LOCALES, type Locale } from "@/lib/i18n";

export default function LanguageSwitcher({ locale, label }: { locale: Locale; label: string }) {
  const router = useRouter();
  return (
    <label className="inline-flex items-center gap-2 text-sm text-muted">
      <svg viewBox="0 0 24 24" className="h-4 w-4 text-subtle" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" /></svg>
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={locale}
        onChange={(e) => {
          document.cookie = `${LOCALE_COOKIE}=${e.target.value}; path=/; max-age=31536000; samesite=lax`;
          router.refresh();
        }}
        className="cursor-pointer rounded-lg border border-line bg-surface-2 px-2 py-1 text-sm text-fg-2 hover:border-line-strong focus:border-brand-500 focus:outline-none"
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>{LOCALE_NAMES[l]}</option>
        ))}
      </select>
    </label>
  );
}
