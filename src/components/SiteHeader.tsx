import Link from "next/link";
import Logo from "@/components/Logo";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import type { Dict, Locale } from "@/lib/i18n";

/** En-tête public (accueil, calculateur, connexion, inscription). */
export default function SiteHeader({ locale, t }: { locale: Locale; t: Dict }) {
  const n = t.landing.nav;
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4">
        <Logo />
        <nav className="hidden items-center gap-6 text-sm font-medium text-muted md:flex">
          <Link href="/#features" className="hover:text-fg">{n.features}</Link>
          <Link href="/#how" className="hover:text-fg">{n.how}</Link>
          <Link href="/#pricing" className="hover:text-fg">{n.pricing}</Link>
          <Link href="/#faq" className="hover:text-fg">{n.faq}</Link>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <div className="hidden sm:block">
            <LanguageSwitcher locale={locale} label={t.common.language} />
          </div>
          <Link href="/login" className="whitespace-nowrap text-sm font-medium text-fg-2 hover:text-fg">{n.login}</Link>
          <Link href="/register" className="btn-primary hidden whitespace-nowrap px-4 py-2 text-sm sm:inline-flex">{n.cta}</Link>
        </div>
      </div>
    </header>
  );
}
