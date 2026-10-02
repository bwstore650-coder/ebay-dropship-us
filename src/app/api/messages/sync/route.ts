import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { syncBuyerMessages } from "@/lib/buyer-messages";

export const maxDuration = 60;

/** Relire maintenant les questions des acheteurs sur eBay. */
export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (user.plan === "NONE") return NextResponse.json({ error: "PLAN_REQUIRED" }, { status: 402 });
  try {
    return NextResponse.json(await syncBuyerMessages(user, { drafts: 3 }));
  } catch (e) {
    console.error("Questions acheteurs (manuel)", e);
    return NextResponse.json({ error: "UPSTREAM" }, { status: 502 });
  }
}
