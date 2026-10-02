import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getDict, isLocale } from "@/lib/i18n";
import { pushToUser } from "@/lib/notify";

/** Notification de test sur les appareils du vendeur. */
export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const t = getDict(isLocale(user.locale) ? user.locale : "en").emails;
  const sent = await pushToUser(user.id, { title: t.pushTitle, body: "Sellvela · test", url: "/settings#notifications" });
  return NextResponse.json({ sent });
}
