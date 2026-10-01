/**
 * Générations IA à la demande (bouton « Régénérer », Title Builder, amélioration d'annonce, extension) :
 * vérifie la formule, réserve une génération du quota, appelle l'IA, rend la génération en cas d'échec.
 */
import type { Plan } from "@prisma/client";
import { z } from "zod";
import { AiError, aiConfigured, LANG_NAMES, writeDescription, writeTitles, type TitleContext } from "@/lib/ai";
import { aiUsage, refundAiCredit, takeAiCredit } from "@/lib/ai-quota";
import { sanitizeDescription } from "@/lib/listing";

export type AiServiceError = "PLAN_REQUIRED" | "AI_NOT_CONFIGURED" | "AI_LIMIT" | "AI_FAILED" | "INVALID_INPUT";
export class AiServiceFailure extends Error {
  constructor(readonly code: AiServiceError) {
    super(code);
  }
}

const str = (max: number) => z.string().trim().max(max);
export const generateSchema = z.object({
  kind: z.enum(["titles", "description"]),
  context: z.object({
    language: z.enum(Object.keys(LANG_NAMES) as [keyof typeof LANG_NAMES, ...(keyof typeof LANG_NAMES)[]]),
    productTitle: str(300).min(3),
    facts: str(5000).optional(),
    variant: str(120).optional(),
    comparableTitles: z.array(str(200)).max(10).optional(),
    keywords: z.array(str(40)).max(40).optional(),
    currentTitle: str(120).optional(),
  }),
});
export type GenerateInput = z.infer<typeof generateSchema>;

type AiUser = { id: string; plan: Plan };

/** Génère des titres ou une description ; renvoie aussi le quota à jour. */
export async function generate(user: AiUser, input: GenerateInput) {
  if (user.plan === "NONE") throw new AiServiceFailure("PLAN_REQUIRED");
  if (!aiConfigured()) throw new AiServiceFailure("AI_NOT_CONFIGURED");
  if (input.kind === "description" && !(input.context.facts && input.context.facts.length >= 20)) throw new AiServiceFailure("INVALID_INPUT");
  try {
    await takeAiCredit(user);
  } catch {
    throw new AiServiceFailure("AI_LIMIT");
  }
  try {
    const c = input.context;
    if (input.kind === "titles") {
      const titles = await writeTitles(c as TitleContext);
      return { titles, usage: await aiUsage(user) };
    }
    const html = await writeDescription({ language: c.language, productTitle: c.productTitle, facts: c.facts!, variant: c.variant });
    return { descriptionHtml: sanitizeDescription(html), usage: await aiUsage(user) };
  } catch (e) {
    await refundAiCredit(user);
    if (!(e instanceof AiError)) console.error("IA", e);
    else console.error("IA", e.message);
    throw new AiServiceFailure("AI_FAILED");
  }
}
