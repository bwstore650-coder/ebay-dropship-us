import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { runState, stopRun } from "@/lib/sniper-service";

/** Arrête une recherche (les produits déjà trouvés restent). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { id } = await params;
  await stopRun(user.id, id);
  const state = await runState(user.id, id);
  return state ? NextResponse.json(state) : NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
}
