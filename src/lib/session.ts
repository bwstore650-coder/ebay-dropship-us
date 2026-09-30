/** Session : jeton JWT signé dans un cookie httpOnly (compatible middleware Edge). */
import { SignJWT, jwtVerify } from "jose";

export { SESSION_COOKIE } from "@/lib/session-cookie";
const secret = () => new TextEncoder().encode(process.env.SESSION_SECRET ?? "");

export async function signSession(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret());
}

export async function verifySession(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

/** Identifiant et date d'émission (secondes) de la session, ou null. */
export async function readSession(token: string | undefined): Promise<{ userId: string; issuedAt?: number } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return typeof payload.sub === "string" ? { userId: payload.sub, issuedAt: payload.iat } : null;
  } catch {
    return null;
  }
}
