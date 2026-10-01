import { NextResponse } from "next/server";
import { brandCheck, ExtensionError } from "@/lib/extension";
import { extRoute, readJson } from "@/lib/extension-route";

export const dynamic = "force-dynamic";

/** Vérificateur de marque : { text } → marque protégée (VeRO) ou imitation détectée. */
export const POST = extRoute(async (_user, req) => {
  const b = await readJson(req);
  if (typeof b?.text !== "string" || !b.text.trim()) throw new ExtensionError("INVALID_INPUT");
  return NextResponse.json(brandCheck(b.text));
});
