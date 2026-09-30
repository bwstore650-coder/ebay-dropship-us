import { z } from "zod";

const schema = z.object({
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  ADMIN_EMAILS: z.string().default(""), // emails séparés par des virgules : accès à /admin
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET : 32 caractères minimum"),
  ENCRYPTION_KEY: z.string().length(64, "ENCRYPTION_KEY : 64 caractères hexadécimaux (32 octets)"),

  EBAY_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  EBAY_CLIENT_ID: z.string().default(""),
  EBAY_CLIENT_SECRET: z.string().default(""),
  EBAY_RUNAME: z.string().default(""),
  // Jeton de vérification déclaré chez eBay pour les notifications de suppression de compte (32 à 80 caractères).
  EBAY_DELETION_TOKEN: z.string().default(""),

  ALIEXPRESS_APP_KEY: z.string().default(""),
  ALIEXPRESS_APP_SECRET: z.string().default(""),

  STRIPE_SECRET_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),
  STRIPE_PRICE_STARTER_MONTHLY: z.string().default(""),
  STRIPE_PRICE_STARTER_YEARLY: z.string().default(""),
  STRIPE_PRICE_PRO_MONTHLY: z.string().default(""),
  STRIPE_PRICE_PRO_YEARLY: z.string().default(""),
  STRIPE_PRICE_BUSINESS_MONTHLY: z.string().default(""),
  STRIPE_PRICE_BUSINESS_YEARLY: z.string().default(""),
  STRIPE_PRICE_AGENCY_MONTHLY: z.string().default(""),
  STRIPE_PRICE_AGENCY_YEARLY: z.string().default(""),
});

let cached: z.infer<typeof schema> | null = null;
export function env() {
  // Espaces ou retours à la ligne collés par erreur avec une clé : on les retire (une clé n'en contient jamais).
  if (!cached) cached = schema.parse(Object.fromEntries(Object.entries(process.env).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v])));
  return cached;
}
