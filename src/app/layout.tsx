import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "eBay Dropship US — produits rentables et conformes",
  description: "Trouve, liste et commande automatiquement des produits à 30 % de marge sur eBay US, sans risquer ton compte.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
