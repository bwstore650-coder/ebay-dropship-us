import type { Metadata } from "next";
import "./globals.css";
import { cookies } from "next/headers";
import { getI18n } from "@/lib/i18n/server";
import CookieBanner from "@/components/CookieBanner";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.meta.title, description: t.meta.description };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale, t } = await getI18n();
  const hasConsent = Boolean((await cookies()).get("consent")?.value);
  return (
    <html lang={locale}>
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        {children}
        <CookieBanner t={t.cookies} initiallyVisible={!hasConsent} />
      </body>
    </html>
  );
}
