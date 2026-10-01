import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmt } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { isAdminEmail, parseAdminEmails } from "@/lib/admin";
import AppSidebar, { type NavSection } from "@/components/AppSidebar";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { Icon } from "@/components/icons";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const { locale, t } = await getI18n();
  const n = t.nav;
  const isAdmin = isAdminEmail(user.email, parseAdminEmails(process.env.ADMIN_EMAILS));
  const [attention, openReturns] = await Promise.all([
    db.order.count({ where: { userId: user.id, status: { in: ["NEEDS_REVIEW", "FAILED"] } } }),
    db.afterSale.count({ where: { userId: user.id, open: true, action: null } }),
  ]);

  const sections: NavSection[] = [
    {
      items: [
        { href: "/dashboard", label: n.dashboard, icon: "home" },
        { href: "/finder", label: n.finder, icon: "search" },
        { href: "/sniper", label: n.sniper, icon: "zap" },
        { href: "/listings", label: n.listings, icon: "tag" },
        { href: "/orders", label: n.orders, icon: "box", badge: attention },
        { href: "/returns", label: n.returns, icon: "undo", badge: openReturns },
      ],
    },
    {
      title: n.sectionResearch,
      items: [
        { href: "/best-sellers", label: n.bestSellers, icon: "fire" },
        { href: "/high-ticket", label: n.highTicket, icon: "star" },
        { href: "/saved", label: n.saved, icon: "bookmark" },
        { href: "/title-builder", label: n.titleBuilder, icon: "type" },
      ],
    },
    {
      title: n.sectionAccount,
      items: [
        { href: "/settings", label: n.settings, icon: "settings" },
        { href: "/billing", label: n.billing, icon: "card" },
        { href: "/affiliate", label: n.affiliate, icon: "users" },
        ...(user.plan !== "NONE" ? [{ href: "/review", label: n.review, icon: "star" as const }] : []),
        ...(isAdmin ? [{ href: "/admin", label: n.admin, icon: "shield" as const }] : []),
      ],
    },
  ];

  const initial = (user.email[0] ?? "?").toUpperCase();
  const footer = (
    <div className="space-y-3">
      {user.plan === "NONE" ? (
        <Link href="/billing" className="block rounded-xl border border-brand-500/30 bg-gradient-to-br from-brand-500/15 to-fuchsia-500/10 p-3 text-sm">
          <span className="block font-semibold text-fg">{n.noPlan}</span>
          <span className="mt-0.5 inline-flex items-center gap-1 text-brand-300">{n.upgrade} <Icon name="arrowRight" className="h-3.5 w-3.5" /></span>
        </Link>
      ) : (
        <Link href="/billing" className="flex items-center justify-between rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm hover:border-line-strong">
          <span className="text-muted">{fmt(n.plan, { plan: t.plans[user.plan] })}</span>
          <span className="badge bg-brand-500/15 text-brand-300">{t.plans[user.plan]}</span>
        </Link>
      )}
      <div className="flex items-center gap-3 px-1">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-3 text-sm font-semibold text-fg-2">{initial}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-fg-2" title={user.email}>{user.email}</span>
        <form action="/api/auth/logout" method="post">
          <button className="btn-ghost px-2" title={n.logout} aria-label={n.logout}>
            <Icon name="logout" className="h-[18px] w-[18px]" />
          </button>
        </form>
      </div>
      <div className="px-1">
        <LanguageSwitcher locale={locale} label={t.common.language} />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      <AppSidebar sections={sections} footer={footer} menuLabel={n.menu} closeLabel={n.close} />
      <div className="lg:pl-64">
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">{children}</main>
      </div>
    </div>
  );
}
