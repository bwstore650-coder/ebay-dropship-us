"use client";
import { useRouter } from "next/navigation";
import { LOCALE_COOKIE, LOCALE_NAMES, LOCALES, type Locale } from "@/lib/i18n";

export default function LanguageSwitcher({ locale, label }: { locale: Locale; label: string }) {
  const router = useRouter();
  return (
    <label className="inline-flex items-center gap-2 text-sm text-slate-600">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={locale}
        onChange={(e) => {
          document.cookie = `${LOCALE_COOKIE}=${e.target.value}; path=/; max-age=31536000; samesite=lax`;
          router.refresh();
        }}
        className="rounded-md border border-slate-300 bg-white px-2 py-1"
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>{LOCALE_NAMES[l]}</option>
        ))}
      </select>
    </label>
  );
}
