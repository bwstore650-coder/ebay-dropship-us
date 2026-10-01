/**
 * Rédaction par l'IA (API Claude d'Anthropic) : titres eBay, description et caractéristiques,
 * dans la langue du site eBay. Sans clé ANTHROPIC_API_KEY (ou en cas d'erreur), on revient au texte du fournisseur.
 *
 * Règles communes : jamais de marque (le produit est sans marque) — chaque titre proposé est revérifié
 * avec la liste des marques protégées (VeRO) et écarté s'il en contient une.
 */
import { z } from "zod";
import type { AspectDef } from "@/lib/ebay";
import { findVeroBrand } from "@/lib/compliance";
import { cleanTitle } from "@/lib/listing";

export const LANG_NAMES = { en: "English", de: "German", fr: "French", it: "Italian", es: "Spanish" } as const;
export type AiLanguage = keyof typeof LANG_NAMES;
/** Nombre de titres proposés au vendeur. */
export const TITLE_OPTIONS = 3;
const MIN_TITLE = 10;

export const aiConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);
export const aiModel = () => process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";

export interface ListingCopyInput {
  language: AiLanguage;
  supplierTitle: string;
  supplierDescription: string; // texte brut (HTML retiré)
  variant?: string;
  comparableTitles: string[];  // titres d'annonces eBay comparables (mots-clés que cherchent les acheteurs)
  aspects: AspectDef[];        // caractéristiques de la catégorie
}

export interface ListingCopy {
  title: string;
  titles: string[];            // propositions (la première = title)
  descriptionHtml: string;
  aspects: Record<string, string[]>;
  source: "ai" | "supplier";
}

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

/** Titres utilisables : nettoyés, ≤ 80 caractères, sans marque protégée, sans doublon. */
export function safeTitles(raw: unknown[]): string[] {
  const out: string[] = [];
  for (const r of raw) {
    if (typeof r !== "string") continue;
    const t = cleanTitle(r.replace(/[!*™®©]/g, " "));
    if (t.length < MIN_TITLE || findVeroBrand(t)) continue;
    if (!out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function supplierDescriptionHtml(i: { supplierTitle: string; supplierDescription: string }): string {
  const lines = i.supplierDescription.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 12);
  return lines.length ? `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : `<p>${esc(i.supplierTitle)}</p>`;
}

/** Texte du fournisseur (sans IA) : titre nettoyé et description en liste. */
export function supplierCopy(i: ListingCopyInput): ListingCopy {
  const title = cleanTitle(`${i.supplierTitle}${i.variant ? ` ${i.variant}` : ""}`);
  return { title, titles: [title], descriptionHtml: supplierDescriptionHtml(i), aspects: {}, source: "supplier" };
}

/* ---------- Appel à l'API Claude ---------- */

export class AiError extends Error {}

/** Appel avec un outil imposé : la réponse est toujours un objet JSON conforme au schéma. */
async function callTool(prompt: string, tool: { name: string; description: string; input_schema: object }, maxTokens = 2000): Promise<unknown> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new AiError("AI_NOT_CONFIGURED");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: aiModel(),
      max_tokens: maxTokens,
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new AiError(`Anthropic ${res.status} : ${(await res.text()).slice(0, 500)}`);
  const data = (await res.json()) as { content?: { type: string; input?: unknown }[] };
  const block = data.content?.find((c) => c.type === "tool_use");
  if (!block?.input) throw new AiError("Réponse IA vide");
  return block.input;
}

const TITLE_RULES = `- Each title: at most 80 characters, keyword-rich, natural, the most searched words first. No ALL CAPS, no emojis, no symbols like ! or *.
- The ${TITLE_OPTIONS} titles must be clearly different (different word order or angle), all accurate to the product.
- NEVER mention a brand name or trademark (the item is unbranded). No "compatible with <brand>", "for <brand>" or "like <brand>" either.
- Do not invent features, quantities or materials that are not in the facts.`;

/* ---------- Brouillon complet (création d'annonce) ---------- */

function listingPrompt(i: ListingCopyInput): string {
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

Titles of comparable eBay listings (use their search keywords, never copy them):
${i.comparableTitles.slice(0, 8).map((t) => `- ${t}`).join("\n") || "- (none)"}

Item specifics of the eBay category:
${aspectLines || "- (none)"}

Rules:
- titles: exactly ${TITLE_OPTIONS} title options, best first.
${TITLE_RULES}
- description_html: clear, honest, based only on the supplier facts. Use <h3>, <p>, <ul><li>. No links, images, scripts, styles or contact details. No shipping-time promises. Under 3,000 characters.
- aspects: fill every REQUIRED item specific you can infer from the facts, plus useful optional ones. Use exact aspect names. For "choose ONLY from" lists, use one of those exact values. Do not invent specifications that are not in the facts. Do not set the Brand aspect.`;
}

const listingOutput = z.object({
  titles: z.array(z.string()).min(1),
  description_html: z.string().min(20),
  aspects: z.record(z.string(), z.array(z.string())).default({}),
});

/** Brouillon d'annonce par l'IA (titres, description, caractéristiques) ; repli sur le fournisseur si l'IA échoue. */
export async function writeListingCopy(i: ListingCopyInput): Promise<ListingCopy> {
  if (!aiConfigured()) return supplierCopy(i);
  try {
    const raw = await callTool(listingPrompt(i), {
      name: "save_listing",
      description: "Save the eBay listing content.",
      input_schema: {
        type: "object",
        properties: {
          titles: { type: "array", items: { type: "string" }, description: `${TITLE_OPTIONS} title options, max 80 characters each` },
          description_html: { type: "string", description: "Listing description in simple HTML" },
          aspects: { type: "object", additionalProperties: { type: "array", items: { type: "string" } } },
        },
        required: ["titles", "description_html", "aspects"],
      },
    });
    const parsed = listingOutput.safeParse(raw);
    if (!parsed.success) throw new AiError("Réponse IA invalide");
    const titles = safeTitles(parsed.data.titles);
    const base = supplierCopy(i);
    return {
      title: titles[0] ?? base.title,
      titles: titles.length ? titles : base.titles,
      descriptionHtml: parsed.data.description_html,
      aspects: parsed.data.aspects,
      source: "ai",
    };
  } catch (e) {
    console.error("IA annonce", e);
    return supplierCopy(i);
  }
}

/* ---------- Titres seuls (éditeur, Title Builder, extension) ---------- */

export interface TitleContext {
  language: AiLanguage;
  productTitle: string;        // titre fournisseur ou titre actuel
  facts?: string;              // description fournisseur (texte brut)
  variant?: string;
  comparableTitles?: string[];
  keywords?: string[];         // mots qui vendent (Title Builder), du plus fort au plus faible
  currentTitle?: string;       // titre à améliorer
}

function titlesPrompt(c: TitleContext): string {
  return `You write eBay listing titles for a dropshipping seller. Write in ${LANG_NAMES[c.language]}.

Product: ${c.productTitle}
${c.variant ? `Variant: ${c.variant}\n` : ""}${c.facts ? `Product facts (may be poorly translated):\n${c.facts.slice(0, 3000)}\n` : ""}${c.currentTitle ? `Current title to improve: ${c.currentTitle}\n` : ""}${
    c.keywords?.length ? `Words that buyers search for, strongest first: ${c.keywords.slice(0, 30).join(", ")}\n` : ""
  }${c.comparableTitles?.length ? `Titles of comparable eBay listings (use their keywords, never copy them):\n${c.comparableTitles.slice(0, 8).map((t) => `- ${t}`).join("\n")}\n` : ""}
Rules:
- Exactly ${TITLE_OPTIONS} title options, best first.
${TITLE_RULES}`;
}

/** Propositions de titres (au moins un titre utilisable, sinon AiError). */
export async function writeTitles(c: TitleContext): Promise<string[]> {
  const raw = await callTool(titlesPrompt(c), {
    name: "save_titles",
    description: "Save the eBay title options.",
    input_schema: {
      type: "object",
      properties: { titles: { type: "array", items: { type: "string" }, description: `${TITLE_OPTIONS} title options, max 80 characters each` } },
      required: ["titles"],
    },
  }, 600);
  const parsed = z.object({ titles: z.array(z.string()) }).safeParse(raw);
  const titles = parsed.success ? safeTitles(parsed.data.titles) : [];
  if (!titles.length) throw new AiError("Aucun titre utilisable");
  return titles.slice(0, TITLE_OPTIONS);
}

/* ---------- Description seule (éditeur, amélioration d'une annonce) ---------- */

export interface DescriptionContext {
  language: AiLanguage;
  productTitle: string;
  facts: string;               // description fournisseur ou description actuelle (texte brut)
  variant?: string;
}

/** Nouvelle description HTML (simple), à passer ensuite par sanitizeDescription. */
export async function writeDescription(c: DescriptionContext): Promise<string> {
  const prompt = `You write the description of an eBay listing for a dropshipping seller. Write in ${LANG_NAMES[c.language]}.

Product: ${c.productTitle}
${c.variant ? `Variant: ${c.variant}\n` : ""}Product facts (may be poorly translated or messy):
${c.facts.slice(0, 5000)}

Rules:
- Clear, honest and easy to scan, based only on these facts. Start with one short sentence on what it is and why it is useful, then key features as a list, then specifications.
- Use only <h3>, <p>, <ul>, <li>, <strong>. No links, images, scripts, styles or contact details. No shipping-time promises.
- NEVER mention a brand name or trademark. Do not invent features, certifications or materials.
- Under 3,000 characters.`;
  const raw = await callTool(prompt, {
    name: "save_description",
    description: "Save the eBay listing description.",
    input_schema: { type: "object", properties: { description_html: { type: "string" } }, required: ["description_html"] },
  });
  const parsed = z.object({ description_html: z.string().min(20) }).safeParse(raw);
  if (!parsed.success) throw new AiError("Réponse IA invalide");
  return parsed.data.description_html;
}
