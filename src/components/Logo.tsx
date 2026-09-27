import Link from "next/link";
import { BRAND } from "@/lib/brand";

/** Logo : une flèche de croissance dans un carré, suivie du nom. */
export default function Logo({ dark = false, href = "/" }: { dark?: boolean; href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 font-bold tracking-tight">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white shadow-sm">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 17l6-6 4 4 6-7" />
          <path d="M15 8h5v5" />
        </svg>
      </span>
      <span className={dark ? "text-white" : "text-slate-900"}>{BRAND.name}</span>
    </Link>
  );
}
