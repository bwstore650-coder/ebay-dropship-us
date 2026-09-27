import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";
import { isAdminEmail, parseAdminEmails } from "@/lib/admin";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import Logo from "@/components/Logo";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const { locale, t } = await getI18n();
  const isAdmin = isAdminEmail(user.email, parseAdminEmails(process.env.ADMIN_EMAILS));
  const links = [
    ["/dashboard", t.nav.dashboard],
    ["/finder", t.nav.finder],
    ["/settings", t.nav.settings],
    ["/billing", t.nav.billing],
    ["/affiliate", t.nav.affiliate],
  ] as const;
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4">
          <Logo href="/dashboard" />
          <div className="ml-auto flex items-center gap-4 text-sm">
            {isAdmin && (
              <Link href="/admin" className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-700">Admin</Link>
            )}
            <LanguageSwitcher locale={locale} label={t.common.language} />
            <form action="/api/auth/logout" method="post">
              <button className="font-medium text-slate-500 hover:text-slate-900">{t.nav.logout}</button>
            </form>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2 text-sm font-medium">
          {links.map(([href, label]) => (
            <Link key={href} href={href} className="whitespace-nowrap rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900">
              {label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
