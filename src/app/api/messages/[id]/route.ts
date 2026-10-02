import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { dismissMessage, draftMessage, MessageError, sendReply } from "@/lib/buyer-messages";

export const maxDuration = 60;

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("draft") }),
  z.object({ action: z.literal("send"), body: z.string().min(1).max(2000) }),
  z.object({ action: z.literal("dismiss") }),
]);

/** Question d'un acheteur : préparer la réponse (IA), l'envoyer, ou l'ignorer. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (user.plan === "NONE") return NextResponse.json({ error: "PLAN_REQUIRED" }, { status: 402 });
  const { id } = await params;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  try {
    if (parsed.data.action === "draft") return NextResponse.json({ draft: await draftMessage(user, id) });
    if (parsed.data.action === "send") await sendReply(user, id, parsed.data.body);
    else await dismissMessage(user.id, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof MessageError) return NextResponse.json({ error: e.code }, { status: e.code === "NOT_FOUND" ? 404 : e.code === "AI_LIMIT" ? 429 : 400 });
    console.error("Question acheteur", id, e);
    return NextResponse.json({ error: "UPSTREAM" }, { status: 502 });
  }
}
