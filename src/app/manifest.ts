import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";

/** Application installable (PWA) : icône sur l'écran d'accueil, ouverture en plein écran sur le tableau de bord. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/dashboard",
    name: BRAND.name,
    short_name: BRAND.name,
    description: "eBay dropshipping: profitable products, automatic listings and orders.",
    start_url: "/dashboard?source=pwa",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#11141b",
    theme_color: "#11141b",
    categories: ["business", "productivity", "shopping"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Orders", url: "/orders", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Product Sniper", url: "/sniper", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Performance", url: "/performance", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
