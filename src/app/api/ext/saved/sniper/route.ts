import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { extRoute, readJson } from "@/lib/extension-route";
import { sendSavedToSniper } from "@/lib/saved-products";

export const dynamic = "force-dynamic";

/** Envoie la liste d'idées au Sniper (les plus récentes, 50 au maximum) : { marketId? }. */
export const POST = extRoute(async (user, req) => {
  const b = await readJson(req);
  const { runId, count } = await sendSavedToSniper(user, b?.marketId);
  return NextResponse.json({ runId, count, url: `${env().APP_URL.replace(/\/+$/, "")}/sniper` });
});
