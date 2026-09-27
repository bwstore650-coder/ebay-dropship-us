import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";
import LanguageSwitcher from "@/components/LanguageSwitcher";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const { locale, t } = await getI18n();
  return (
    <div>
      <header className="border-b border-slate-200 bg-white">
        <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-4 py-3 text-sm">
          <span className="font-bold">{t.common.appName}</span>
          <Link href="/dashboard" className="hover:text-blue-600">{t.nav.dashboard}</Link>
          <Link href="/finder" className="hover:text-blue-600">{t.nav.finder}</Link>
          <Link href="/settings" className="hover:text-blue-600">{t.nav.settings}</Link>
          <Link href="/billing" className="hover:text-blue-600">{t.nav.billing}</Link>
          <Link href="/affiliate" className="hover:text-blue-600">{t.nav.affiliate}</Link>
          <div className="ml-auto flex items-center gap-3">
            <LanguageSwitcher locale={locale} label={t.common.language} />
            <form action="/api/auth/logout" method="post">
              <button className="text-slate-500 hover:text-slate-900">{t.nav.logout}</button>
            </form>
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
