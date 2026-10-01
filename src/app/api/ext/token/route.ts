import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { createExtensionToken } from "@/lib/extension";

export const dynamic = "force-dynamic";

/** Page « Connecter l'extension » (session du site) : crée un jeton remis à l'extension. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { label?: unknown } | null;
  const label = typeof body?.label === "string" ? body.label : null;
  return NextResponse.json({ token: await createExtensionToken(user.id, label) });
}
