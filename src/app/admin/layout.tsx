import Link from "next/link";
import { requireAdmin } from "@/lib/auth";

export const metadata = { title: "Admin", robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-5 px-4 py-3.5 text-sm font-medium text-fg-2">
          <span className="rounded bg-brand-500 px-2 py-0.5 text-xs font-bold uppercase tracking-wide">Admin</span>
          <Link href="/admin" className="hover:text-fg">Vue d&apos;ensemble</Link>
          <Link href="/admin/users" className="hover:text-fg">Clients</Link>
          <Link href="/admin/affiliates" className="hover:text-fg">Affiliés</Link>
          <Link href="/admin/reviews" className="hover:text-fg">Avis</Link>
          <a href="/api/admin/leads" className="hover:text-fg">Exporter les emails (CSV)</a>
          <span className="ml-auto text-subtle">{admin.email}</span>
          <Link href="/dashboard" className="text-muted hover:text-fg">← App</Link>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
