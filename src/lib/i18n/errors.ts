import type { Dict } from "./index";

export type ErrorCode = keyof Dict["errors"];

/** Message traduit pour un code d'erreur renvoyé par l'API (GENERIC si inconnu). */
export function errorMessage(errors: Dict["errors"], code: unknown): string {
  return typeof code === "string" && code in errors ? errors[code as ErrorCode] : errors.GENERIC;
}
