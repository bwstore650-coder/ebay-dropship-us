import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { advanceRun, runState } from "@/lib/sniper-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Fait avancer la recherche pendant ~40 s (quelques produits), puis renvoie son état. Appelé en boucle par la page. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { id } = await params;
  const owned = await db.snipeRun.findFirst({ where: { id, userId: user.id }, select: { status: true } });
  if (!owned) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (owned.status === "RUNNING") await advanceRun(id, Date.now() + 40_000);
  return NextResponse.json(await runState(user.id, id));
}
