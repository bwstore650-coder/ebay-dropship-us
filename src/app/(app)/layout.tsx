import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  return (
    <div>
      <header className="border-b border-slate-200 bg-white">
        <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-4 py-3 text-sm">
          <span className="font-bold">eBay Dropship US</span>
          <Link href="/dashboard" className="hover:text-blue-600">Tableau de bord</Link>
          <Link href="/finder" className="hover:text-blue-600">Chercheur</Link>
          <Link href="/settings" className="hover:text-blue-600">Réglages</Link>
          <Link href="/billing" className="hover:text-blue-600">Abonnement</Link>
          <form action="/api/auth/logout" method="post" className="ml-auto">
            <button className="text-slate-500 hover:text-slate-900">Déconnexion</button>
          </form>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
