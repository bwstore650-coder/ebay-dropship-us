import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { aiConfigured } from "@/lib/ai";
import { AiLimitError, refundAiCredit, takeAiCredit } from "@/lib/ai-quota";
import { cleanHistory, runAssistant } from "@/lib/assistant";
import { getI18n } from "@/lib/i18n/server";

export const maxDuration = 60;

/** Un message au chat de l'assistant : { messages: [{ role, content }] } (le dernier = la question du vendeur). */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (user.plan === "NONE") return NextResponse.json({ error: "PLAN_REQUIRED" }, { status: 402 });
  if (!aiConfigured()) return NextResponse.json({ error: "AI_NOT_CONFIGURED" }, { status: 503 });
  const body = (await req.json().catch(() => null)) as { messages?: unknown } | null;
  const history = cleanHistory(body?.messages);
  if (!history.length || history[history.length - 1].role !== "user") return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  try {
    await takeAiCredit(user);
  } catch (e) {
    if (e instanceof AiLimitError) return NextResponse.json({ error: "AI_LIMIT" }, { status: 429 });
    throw e;
  }
  const { locale } = await getI18n();
  try {
    return NextResponse.json(await runAssistant(user, history, locale));
  } catch (e) {
    console.error("Assistant", e);
    await refundAiCredit(user);
    return NextResponse.json({ error: "UPSTREAM" }, { status: 502 });
  }
}
