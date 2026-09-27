/**
 * Rédaction de l'annonce par l'IA (API Claude d'Anthropic) : titre, description et caractéristiques
 * dans la langue du site eBay. Sans clé ANTHROPIC_API_KEY, on revient au texte du fournisseur.
 */
import { z } from "zod";
import type { AspectDef } from "@/lib/ebay";

const LANG_NAMES = { en: "English", de: "German", fr: "French", it: "Italian", es: "Spanish" } as const;

export interface ListingCopyInput {
  language: keyof typeof LANG_NAMES;
  supplierTitle: string;
  supplierDescription: string; // texte brut (HTML retiré)
  variant?: string;
  comparableTitles: string[];  // titres d'annonces eBay qui vendent (mots-clés recherchés par les acheteurs)
  aspects: AspectDef[];        // caractéristiques de la catégorie
}

export interface ListingCopy {
  title: string;
  descriptionHtml: string;
  aspects: Record<string, string[]>;
  source: "ai" | "supplier";
}

const output = z.object({
  title: z.string().min(10),
  description_html: z.string().min(20),
  aspects: z.record(z.string(), z.array(z.string())).default({}),
});

/** Texte brut à partir d'un HTML fournisseur. */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*(script|style)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function fallback(i: ListingCopyInput): ListingCopy {
  const lines = i.supplierDescription.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 12);
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return {
    title: `${i.supplierTitle}${i.variant ? ` ${i.variant}` : ""}`,
    descriptionHtml: lines.length ? `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : `<p>${esc(i.supplierTitle)}</p>`,
    aspects: {},
    source: "supplier",
  };
}

function prompt(i: ListingCopyInput): string {
  const aspectLines = i.aspects
    .filter((a) => a.required || a.values.length || a.name)
    .slice(0, 40)
    .map((a) => {
      const vals = a.mode === "SELECTION_ONLY" ? ` — choose ONLY from: ${a.values.slice(0, 60).join(" | ")}` : a.values.length ? ` — e.g. ${a.values.slice(0, 8).join(" | ")}` : "";
      return `- ${a.name}${a.required ? " (REQUIRED)" : ""}${a.multi ? " (several values allowed)" : ""}${vals}`;
    })
    .join("\n");
  return `You write eBay listings for a dropshipping seller. Write in ${LANG_NAMES[i.language]}.

Supplier product title: ${i.supplierTitle}
${i.variant ? `Variant: ${i.variant}\n` : ""}Supplier description (may be poorly translated):
${i.supplierDescription.slice(0, 5000)}

Titles of competing eBay listings that sell well (use their search keywords, never copy them):
${i.comparableTitles.slice(0, 8).map((t) => `- ${t}`).join("\n") || "- (none)"}

Item specifics of the eBay category:
${aspectLines || "- (none)"}

Rules:
- title: at most 80 characters, keyword-rich, natural, no ALL CAPS, no emojis, no symbols like ! or *.
- NEVER mention a brand name or trademark (the item is unbranded). No "compatible with <brand>" either.
- description_html: clear, honest, based only on the supplier facts. Use <h3>, <p>, <ul><li>. No links, images, scripts, styles or contact details. No shipping-time promises. Under 3,000 characters.
- aspects: fill every REQUIRED item specific you can infer from the facts, plus useful optional ones. Use exact aspect names. For "choose ONLY from" lists, use one of those exact values. Do not invent specifications that are not in the facts. Do not set the Brand aspect.`;
}

/** Appel à l'API Claude avec un outil imposé : la réponse est toujours un JSON conforme. */
export async function writeListingCopy(i: ListingCopyInput): Promise<ListingCopy> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return fallback(i);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
        max_tokens: 2000,
        tools: [
          {
            name: "save_listing",
            description: "Save the eBay listing content.",
            input_schema: {
              type: "object",
              properties: {
                title: { type: "string", description: "Listing title, max 80 characters" },
                description_html: { type: "string", description: "Listing description in simple HTML" },
                aspects: { type: "object", additionalProperties: { type: "array", items: { type: "string" } } },
              },
              required: ["title", "description_html", "aspects"],
            },
          },
        ],
        tool_choice: { type: "tool", name: "save_listing" },
        messages: [{ role: "user", content: prompt(i) }],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status} : ${(await res.text()).slice(0, 500)}`);
    const data = (await res.json()) as { content?: { type: string; input?: unknown }[] };
    const block = data.content?.find((c) => c.type === "tool_use");
    const parsed = output.safeParse(block?.input);
    if (!parsed.success) throw new Error("Réponse IA invalide");
    return { title: parsed.data.title, descriptionHtml: parsed.data.description_html, aspects: parsed.data.aspects, source: "ai" };
  } catch (e) {
    console.error("IA annonce", e);
    return fallback(i);
  }
}
