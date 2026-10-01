import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/extension";

export const dynamic = "force-dynamic";

/** « Se déconnecter » dans l'extension : supprime son propre jeton. */
export async function POST(req: Request) {
  const h = req.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!token || token.length > 200) return NextResponse.json({ ok: true });
  await db.extensionToken.deleteMany({ where: { tokenHash: hashToken(token) } });
  return NextResponse.json({ ok: true });
}
