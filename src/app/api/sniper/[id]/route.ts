import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { runState } from "@/lib/sniper-service";

export const dynamic = "force-dynamic";

/** État d'une recherche Sniper (compteurs et produits analysés). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const state = await runState(user.id, (await params).id);
  return state ? NextResponse.json(state) : NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
}
