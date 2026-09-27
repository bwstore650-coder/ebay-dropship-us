import { z } from "zod";

/** Données envoyées par le formulaire d'avis (le client doit être connecté). */
export const reviewInput = z.object({
  rating: z.number().int().min(1).max(5),
  text: z.string().trim().min(20).max(1000),
  authorName: z.string().trim().min(2).max(40),
  authorInfo: z.string().trim().max(60).optional().default(""),
  consent: z.literal(true),
});
export type ReviewInput = z.infer<typeof reviewInput>;

/** Moyenne arrondie à 0,1 et nombre d'avis ; null s'il n'y a aucun avis. */
export function reviewSummary(ratings: number[]): { avg: string; n: number } | null {
  if (ratings.length === 0) return null;
  const avg = ratings.reduce((s, r) => s + r, 0) / ratings.length;
  return { avg: (Math.round(avg * 10) / 10).toFixed(1), n: ratings.length };
}
