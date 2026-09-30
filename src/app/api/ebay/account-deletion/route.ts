import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getNotificationPublicKey } from "@/lib/ebay";
import { challengeResponse, DELETION_PATH, parseDeletionNotice, parseSignatureHeader, verifySignature } from "@/lib/ebay-deletion";

export const dynamic = "force-dynamic";

const keys = new Map<string, string>();
const endpoint = () => `${env().APP_URL.replace(/\/$/, "")}${DELETION_PATH}`;

/** Validation de l'adresse par eBay. */
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("challenge_code");
  const token = env().EBAY_DELETION_TOKEN;
  if (!code || !token) return NextResponse.json({ error: "NOT_CONFIGURED" }, { status: 400 });
  return NextResponse.json({ challengeResponse: challengeResponse(code, token, endpoint()) });
}

/** Un compte eBay a été supprimé : on efface ce qu'on garde sur lui. */
export async function POST(req: Request) {
  const raw = await req.text();
  const sig = parseSignatureHeader(req.headers.get("x-ebay-signature"));
  if (!sig) return new NextResponse(null, { status: 412 });
  try {
    let key = keys.get(sig.kid);
    if (!key) {
      key = (await getNotificationPublicKey(sig.kid)).key;
      keys.set(sig.kid, key);
    }
    if (!verifySignature(raw, sig, key)) return new NextResponse(null, { status: 412 });
  } catch (e) {
    console.error("Suppression de compte eBay : clé publique", e);
    return new NextResponse(null, { status: 500 }); // eBay réessaiera
  }

  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse(null, { status: 204 });
  }
  const notice = parseDeletionNotice(body);
  if (notice) {
    // Acheteur : on retire son pseudo et son prénom de nos commandes.
    if (notice.username) {
      await db.order.updateMany({ where: { buyerUsername: notice.username }, data: { buyerUsername: null, buyerName: null } });
    }
    // Vendeur connecté avec ce compte eBay : on oublie ses jetons d'accès.
    const ids = [notice.userId, notice.username].filter((v): v is string => !!v);
    if (ids.length) {
      await db.ebayAccount.deleteMany({ where: { ebayUserId: { in: ids } } }).catch((e: unknown) => console.error("Suppression de compte eBay : vendeur", e));
    }
  }
  return new NextResponse(null, { status: 204 });
}
