import Link from "next/link";
import { BRAND } from "@/lib/brand";

/** Logo : une flèche de croissance dans un carré en dégradé, suivie du nom. */
export default function Logo({ href = "/" }: { dark?: boolean; href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2.5 font-bold tracking-tight">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-700 text-white shadow-[0_0_0_1px_rgb(255_255_255/0.12)_inset,0_6px_20px_-6px_rgb(109_106_248/0.8)]">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 17l6-6 4 4 6-7" />
          <path d="M15 8h5v5" />
        </svg>
      </span>
      <span className="text-fg">{BRAND.name}</span>
    </Link>
  );
}
