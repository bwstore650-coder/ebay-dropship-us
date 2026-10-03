"use client";
import { useEffect } from "react";

/** Enregistre le service worker (application installable, page hors ligne, notifications). */
export default function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
