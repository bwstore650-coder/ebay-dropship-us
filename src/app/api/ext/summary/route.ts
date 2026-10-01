import { NextResponse } from "next/server";
import { extensionSummary } from "@/lib/extension";
import { extRoute } from "@/lib/extension-route";

export const dynamic = "force-dynamic";

/** Résumé du compte pour la popup, le badge et les notifications (?since=date ISO du dernier passage). */
export const GET = extRoute(async (user, req) => {
  const raw = new URL(req.url).searchParams.get("since");
  const t = raw ? Date.parse(raw) : NaN;
  // Jamais plus de 3 jours en arrière (une extension restée éteinte ne reçoit pas une avalanche de notifications).
  const since = Number.isFinite(t) ? new Date(Math.max(t, Date.now() - 3 * 86_400_000)) : null;
  return NextResponse.json(await extensionSummary(user, since));
});
