/**
 * Notifications eBay « suppression de compte » (Marketplace Account Deletion), obligatoires pour les clés Production.
 * 1. eBay valide l'adresse avec un « challenge » (GET) : on répond sha256(code + jeton + adresse).
 * 2. Ensuite, à chaque compte eBay supprimé, eBay envoie une notification signée (POST) :
 *    on vérifie la signature puis on efface ce qu'on garde sur cet utilisateur.
 */
import crypto from "node:crypto";

export const DELETION_PATH = "/api/ebay/account-deletion";

export function challengeResponse(challengeCode: string, verificationToken: string, endpoint: string): string {
  return crypto.createHash("sha256").update(challengeCode).update(verificationToken).update(endpoint).digest("hex");
}

export interface SignatureHeader { alg: string; kid: string; signature: string; digest: string }

/** En-tête X-EBAY-SIGNATURE : JSON encodé en base64. */
export function parseSignatureHeader(header: string | null): SignatureHeader | null {
  if (!header) return null;
  try {
    const j = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    if (typeof j?.kid !== "string" || typeof j?.signature !== "string") return null;
    return { alg: String(j.alg ?? "ecdsa"), kid: j.kid, signature: j.signature, digest: String(j.digest ?? "SHA1") };
  } catch {
    return null;
  }
}

/** eBay renvoie la clé en une seule ligne : on la remet au format PEM. */
export function toPem(key: string): string {
  const body = key.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, "").replace(/\s+/g, "");
  return `-----BEGIN PUBLIC KEY-----\n${body.match(/.{1,64}/g)?.join("\n") ?? ""}\n-----END PUBLIC KEY-----\n`;
}

/** Vérifie la signature ECDSA d'eBay sur le corps brut de la requête. */
export function verifySignature(rawBody: string, sig: SignatureHeader, publicKey: string): boolean {
  try {
    const algo = sig.digest.toUpperCase() === "SHA256" ? "sha256" : "sha1";
    return crypto.verify(algo, Buffer.from(rawBody, "utf8"), { key: toPem(publicKey), dsaEncoding: "der" }, Buffer.from(sig.signature, "base64"));
  } catch {
    return false;
  }
}

export interface DeletionNotice { username: string | null; userId: string | null }

/** Données utiles d'une notification (null si ce n'est pas une suppression de compte). */
export function parseDeletionNotice(body: unknown): DeletionNotice | null {
  const b = body as { metadata?: { topic?: string }; notification?: { data?: { username?: string; userId?: string } } } | null;
  if (b?.metadata?.topic !== "MARKETPLACE_ACCOUNT_DELETION") return null;
  const d = b.notification?.data ?? {};
  const username = typeof d.username === "string" && d.username ? d.username : null;
  const userId = typeof d.userId === "string" && d.userId ? d.userId : null;
  return username || userId ? { username, userId } : null;
}
