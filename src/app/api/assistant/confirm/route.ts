import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { executeAction, parseAction } from "@/lib/assistant";

export const maxDuration = 60;

/** Action proposée par l'assistant, confirmée par le vendeur : { tool, args }. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (user.plan === "NONE") return NextResponse.json({ error: "PLAN_REQUIRED" }, { status: 402 });
  const body = (await req.json().catch(() => null)) as { tool?: unknown; args?: unknown } | null;
  const action = typeof body?.tool === "string" ? parseAction(body.tool, body.args) : null;
  if (!action) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const r = await executeAction(user, action.tool, action.args);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
