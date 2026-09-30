import Link from "next/link";
import Logo from "@/components/Logo";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { BRAND } from "@/lib/brand";
import { fmt, type Dict, type Locale } from "@/lib/i18n";

/** Pied de page public, avec la mention de non-affiliation à eBay. */
export default function SiteFooter({ locale, t }: { locale: Locale; t: Dict }) {
  const f = t.landing.footer;
  const n = t.landing.nav;
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-4">
          <Logo />
          <LanguageSwitcher locale={locale} label={t.common.language} />
        </div>
        <div>
          <h3 className="text-sm font-semibold">{f.product}</h3>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            <li><Link href="/#features" className="hover:text-fg">{n.features}</Link></li>
            <li><Link href="/#pricing" className="hover:text-fg">{n.pricing}</Link></li>
            <li><Link href="/#faq" className="hover:text-fg">{n.faq}</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-semibold">{f.resources}</h3>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            <li><Link href="/ebay-profit-calculator" className="hover:text-fg">{f.calculator}</Link></li>
            <li><Link href="/register" className="hover:text-fg">{f.affiliate}</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-semibold">{t.legal.legal}</h3>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            <li><Link href="/terms" className="hover:text-fg">{t.legal.terms}</Link></li>
            <li><Link href="/privacy" className="hover:text-fg">{t.legal.privacy}</Link></li>
            <li><Link href="/refund" className="hover:text-fg">{t.legal.refund}</Link></li>
          </ul>
          <h3 className="mt-6 text-sm font-semibold">{f.contact}</h3>
          <p className="mt-3 text-sm text-muted">
            <a href={`mailto:${BRAND.supportEmail}`} className="hover:text-fg">{BRAND.supportEmail}</a>
          </p>
        </div>
      </div>
      <div className="border-t border-line">
        <div className="mx-auto max-w-6xl space-y-2 px-4 py-6 text-xs text-muted">
          <p>{fmt(f.rights, { year: new Date().getFullYear(), company: BRAND.company })}</p>
          <p>{fmt(f.disclaimer, { brand: BRAND.name })}</p>
        </div>
      </div>
    </footer>
  );
}
