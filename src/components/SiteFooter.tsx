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
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-4">
          <Logo />
          <LanguageSwitcher locale={locale} label={t.common.language} />
        </div>
        <div>
          <h3 className="text-sm font-semibold">{f.product}</h3>
          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            <li><Link href="/#features" className="hover:text-slate-900">{n.features}</Link></li>
            <li><Link href="/#pricing" className="hover:text-slate-900">{n.pricing}</Link></li>
            <li><Link href="/#faq" className="hover:text-slate-900">{n.faq}</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-semibold">{f.resources}</h3>
          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            <li><Link href="/ebay-profit-calculator" className="hover:text-slate-900">{f.calculator}</Link></li>
            <li><Link href="/register" className="hover:text-slate-900">{f.affiliate}</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-semibold">{t.legal.legal}</h3>
          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            <li><Link href="/terms" className="hover:text-slate-900">{t.legal.terms}</Link></li>
            <li><Link href="/privacy" className="hover:text-slate-900">{t.legal.privacy}</Link></li>
            <li><Link href="/refund" className="hover:text-slate-900">{t.legal.refund}</Link></li>
          </ul>
          <h3 className="mt-6 text-sm font-semibold">{f.contact}</h3>
          <p className="mt-3 text-sm text-slate-600">
            <a href={`mailto:${BRAND.supportEmail}`} className="hover:text-slate-900">{BRAND.supportEmail}</a>
          </p>
        </div>
      </div>
      <div className="border-t border-slate-100">
        <div className="mx-auto max-w-6xl space-y-2 px-4 py-6 text-xs text-slate-500">
          <p>{fmt(f.rights, { year: new Date().getFullYear(), company: BRAND.company })}</p>
          <p>{fmt(f.disclaimer, { brand: BRAND.name })}</p>
        </div>
      </div>
    </footer>
  );
}
