import type { Metadata, Viewport } from "next";
import { BRAND } from "@/lib/brand";
import ServiceWorker from "@/components/ServiceWorker";
import "./globals.css";
import { cookies } from "next/headers";
import { getI18n } from "@/lib/i18n/server";
import CookieBanner from "@/components/CookieBanner";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t.meta.title,
    description: t.meta.description,
    applicationName: BRAND.name,
    appleWebApp: { capable: true, title: BRAND.name, statusBarStyle: "black" },
    icons: { icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }], apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }] },
    formatDetection: { telephone: false },
  };
}

export const viewport: Viewport = { themeColor: "#11141b", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale, t } = await getI18n();
  const hasConsent = Boolean((await cookies()).get("consent")?.value);
  return (
    <html lang={locale}>
      <body className="min-h-screen bg-surface-2 text-fg antialiased">
        {children}
        <CookieBanner t={t.cookies} initiallyVisible={!hasConsent} />
        <ServiceWorker />
      </body>
    </html>
  );
}
