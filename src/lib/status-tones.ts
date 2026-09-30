import type { STATUS_TONE } from "@/components/ui";

type Tone = keyof typeof STATUS_TONE;

/** Couleur de la pastille de statut d'une commande. */
export const ORDER_TONE: Record<"PENDING" | "ORDERING" | "ORDERED" | "SHIPPED" | "NEEDS_REVIEW" | "FAILED" | "CANCELLED", Tone> = {
  PENDING: "neutral",
  ORDERING: "sky",
  ORDERED: "brand",
  SHIPPED: "emerald",
  NEEDS_REVIEW: "amber",
  FAILED: "red",
  CANCELLED: "neutral",
};

/** Couleur de la pastille de statut d'une annonce. */
export const LISTING_TONE: Record<"DRAFT" | "ACTIVE" | "PAUSED" | "ENDED", Tone> = {
  DRAFT: "neutral",
  ACTIVE: "emerald",
  PAUSED: "amber",
  ENDED: "neutral",
};
