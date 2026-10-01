import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { AiServiceFailure, generate, generateSchema } from "@/lib/ai-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Titres ou description par l'IA : { kind: "titles" | "description", context }. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const parsed = generateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  try {
    return NextResponse.json(await generate(user, parsed.data));
  } catch (e) {
    if (e instanceof AiServiceFailure) {
      const status = e.code === "PLAN_REQUIRED" ? 402 : e.code === "AI_LIMIT" ? 429 : e.code === "INVALID_INPUT" ? 400 : 503;
      return NextResponse.json({ error: e.code }, { status });
    }
    throw e;
  }
}
