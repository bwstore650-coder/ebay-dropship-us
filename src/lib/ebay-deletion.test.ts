import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { challengeResponse, parseDeletionNotice, parseSignatureHeader, toPem, verifySignature } from "./ebay-deletion";

describe("suppression de compte eBay", () => {
  it("réponse au challenge : sha256(code + jeton + adresse)", () => {
    const expected = crypto.createHash("sha256").update("abc123tokenhttps://sellvela.vercel.app/api/ebay/account-deletion").digest("hex");
    expect(challengeResponse("abc123", "token", "https://sellvela.vercel.app/api/ebay/account-deletion")).toBe(expected);
  });

  it("signature ECDSA d'eBay vérifiée sur le corps brut", () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const body = JSON.stringify({ metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION" }, notification: { data: { username: "buyer1", userId: "u1" } } });
    const signature = crypto.sign("sha1", Buffer.from(body), privateKey).toString("base64");
    const header = Buffer.from(JSON.stringify({ alg: "ecdsa", kid: "k1", signature, digest: "SHA1" })).toString("base64");
    const sig = parseSignatureHeader(header)!;
    expect(sig.kid).toBe("k1");
    // Clé sur une seule ligne, comme la renvoie eBay.
    const oneLine = publicKey.export({ type: "spki", format: "pem" }).toString().replace(/\n/g, "");
    expect(verifySignature(body, sig, oneLine)).toBe(true);
    expect(verifySignature(body + " ", sig, oneLine)).toBe(false);
    expect(toPem(oneLine)).toContain("\n-----END PUBLIC KEY-----");
  });

  it("en-tête absent ou illisible", () => {
    expect(parseSignatureHeader(null)).toBeNull();
    expect(parseSignatureHeader("pas-du-base64-json")).toBeNull();
  });

  it("notification de suppression", () => {
    expect(parseDeletionNotice({ metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION" }, notification: { data: { username: "b", userId: "1" } } })).toEqual({ username: "b", userId: "1" });
    expect(parseDeletionNotice({ metadata: { topic: "OTHER" }, notification: { data: { username: "b" } } })).toBeNull();
    expect(parseDeletionNotice({ metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION" }, notification: { data: {} } })).toBeNull();
  });
});
