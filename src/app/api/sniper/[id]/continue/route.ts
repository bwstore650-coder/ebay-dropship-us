import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { continueRun, runState } from "@/lib/sniper-service";

/** Continue une recherche du catalogue (nouveau lot de produits à analyser). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (user.plan === "NONE") return NextResponse.json({ error: "PLAN_REQUIRED" }, { status: 402 });
  const { id } = await params;
  const r = await continueRun(user.id, id);
  if (r === "NOT_FOUND") return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (r === "EXHAUSTED") return NextResponse.json({ error: "SNIPER_EXHAUSTED" }, { status: 409 });
  const state = await runState(user.id, id);
  return state ? NextResponse.json(state) : NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
}
