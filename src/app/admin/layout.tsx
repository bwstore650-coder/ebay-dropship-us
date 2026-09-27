import Link from "next/link";
import { requireAdmin } from "@/lib/auth";

export const metadata = { title: "Admin", robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-800 bg-slate-900 text-white">
        <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-5 px-4 py-3 text-sm">
          <span className="rounded bg-brand-500 px-2 py-0.5 text-xs font-bold uppercase tracking-wide">Admin</span>
          <Link href="/admin" className="hover:text-brand-300">Vue d&apos;ensemble</Link>
          <Link href="/admin/users" className="hover:text-brand-300">Clients</Link>
          <Link href="/admin/affiliates" className="hover:text-brand-300">Affiliés</Link>
          <a href="/api/admin/leads" className="hover:text-brand-300">Exporter les emails (CSV)</a>
          <span className="ml-auto text-slate-400">{admin.email}</span>
          <Link href="/dashboard" className="text-slate-300 hover:text-white">← App</Link>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
