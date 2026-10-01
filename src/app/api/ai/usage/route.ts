import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { aiConfigured } from "@/lib/ai";
import { aiUsage } from "@/lib/ai-quota";

export const dynamic = "force-dynamic";

/** Quota IA du mois : { used, limit, unlimited, configured }. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  return NextResponse.json({ ...(await aiUsage(user)), configured: aiConfigured() });
}
