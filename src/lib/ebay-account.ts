/** Jeton eBay du vendeur, renouvelé automatiquement s'il a expiré (2 h), puis enregistré chiffré. */
import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { refreshUserToken } from "@/lib/ebay";

export class EbayReconnectRequired extends Error {}

export async function userToken(account: { id: string; accessToken: string; accessTokenExpires: Date; refreshToken: string; refreshTokenExpires: Date }): Promise<string> {
  if (account.accessTokenExpires.getTime() > Date.now() + 5 * 60_000) return decrypt(account.accessToken);
  if (account.refreshTokenExpires.getTime() < Date.now()) throw new EbayReconnectRequired("Jeton eBay expiré : reconnecter le compte");
  const t = await refreshUserToken(decrypt(account.refreshToken));
  await db.ebayAccount.update({
    where: { id: account.id },
    data: { accessToken: encrypt(t.access_token), accessTokenExpires: new Date(Date.now() + t.expires_in * 1000) },
  });
  return t.access_token;
}
