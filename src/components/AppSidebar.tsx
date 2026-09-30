"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/icons";
import Logo from "@/components/Logo";

export interface NavItem { href: string; label: string; icon: IconName; badge?: number }
export interface NavSection { title?: string; items: NavItem[] }

/**
 * Menu latéral de l'application : fixe sur ordinateur, tiroir sur mobile.
 * `footer` = bloc du bas (formule, compte, langue, déconnexion), rendu côté serveur.
 */
export default function AppSidebar({ sections, footer, menuLabel, closeLabel }: { sections: NavSection[]; footer: React.ReactNode; menuLabel: string; closeLabel: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  const nav = (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
      {sections.map((s, i) => (
        <div key={i}>
          {s.title && <p className="eyebrow mb-2 px-3">{s.title}</p>}
          <ul className="space-y-0.5">
            {s.items.map((it) => {
              const active = pathname === it.href || pathname.startsWith(it.href + "/");
              return (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    aria-current={active ? "page" : undefined}
                    className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                      active ? "bg-brand-500/12 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg"
                    }`}
                  >
                    {active && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand-400" aria-hidden="true" />}
                    <Icon name={it.icon} className={`h-[18px] w-[18px] ${active ? "text-brand-300" : "text-subtle group-hover:text-fg-2"}`} />
                    <span className="flex-1">{it.label}</span>
                    {it.badge ? <span className="badge bg-amber-500/15 px-2 text-amber-300">{it.badge}</span> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <>
      {/* Barre du haut (mobile) */}
      <div className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-line bg-canvas/85 px-4 backdrop-blur lg:hidden">
        <button type="button" onClick={() => setOpen(true)} className="btn-ghost -ml-2 px-2" aria-label={menuLabel}>
          <Icon name="menu" />
        </button>
        <Logo href="/dashboard" />
      </div>

      {/* Fond assombri (mobile) */}
      {open && <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden" onClick={() => setOpen(false)} aria-hidden="true" />}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-line bg-surface transition-transform lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex h-16 items-center justify-between px-5">
          <Logo href="/dashboard" />
          <button type="button" onClick={() => setOpen(false)} className="btn-ghost -mr-2 px-2 lg:hidden" aria-label={closeLabel}>
            <Icon name="close" />
          </button>
        </div>
        {nav}
        <div className="border-t border-line p-3">{footer}</div>
      </aside>
    </>
  );
}
