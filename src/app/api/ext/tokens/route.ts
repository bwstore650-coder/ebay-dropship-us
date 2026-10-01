import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Navigateurs connectés (page Réglages). */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tokens = await db.extensionToken.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, label: true, createdAt: true, lastUsedAt: true },
  });
  return NextResponse.json({ tokens });
}

/** Déconnecte un navigateur (?id=…) ou tous. */
export async function DELETE(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  const r = await db.extensionToken.deleteMany({ where: { userId: user.id, ...(id ? { id } : {}) } });
  return NextResponse.json({ deleted: r.count });
}
