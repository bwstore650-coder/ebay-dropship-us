/** Enveloppe commune des routes /api/ext/* : authentification par jeton et réponses d'erreur. */
import { NextResponse } from "next/server";
import { SavedError } from "@/lib/saved-products";
import { isQuotaError } from "@/lib/ebay";
import { extensionUser, ExtensionError, type ExtUser } from "@/lib/extension";
import { SnipeError } from "@/lib/sniper-service";

export function extRoute(handler: (user: ExtUser, req: Request) => Promise<Response>) {
  return async (req: Request) => {
    const user = await extensionUser(req);
    if (!user) return NextResponse.json({ error: "EXT_UNAUTHORIZED" }, { status: 401 });
    try {
      return await handler(user, req);
    } catch (e) {
      if (e instanceof ExtensionError || e instanceof SnipeError || e instanceof SavedError) {
        const status = e.code === "PLAN_REQUIRED" ? 402 : e.code === "RATE_LIMITED" ? 429 : e.code === "NOT_FOUND" ? 404 : e.code === "SNIPE_RUNNING" ? 409 : 400;
        return NextResponse.json({ error: e.code }, { status });
      }
      if (isQuotaError(e)) return NextResponse.json({ error: "EBAY_QUOTA" }, { status: 503 });
      console.error("Extension", req.url, e);
      return NextResponse.json({ error: "UPSTREAM" }, { status: 502 });
    }
  };
}

export const readJson = async (req: Request) => (await req.json().catch(() => null)) as Record<string, unknown> | null;
