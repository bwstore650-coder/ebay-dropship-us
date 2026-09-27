import { describe, expect, it } from "vitest";
import { fmt, getDict, LOCALES, pickLocale } from "./index";

type Tree = { [k: string]: string | Tree };

function flatten(obj: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
const reference = flatten(getDict("en") as unknown as Tree);

describe("traductions", () => {
  for (const locale of LOCALES) {
    const dict = flatten(getDict(locale) as unknown as Tree);
    it(`${locale} : mêmes clés que l'anglais`, () => {
      expect(Object.keys(dict).sort()).toEqual(Object.keys(reference).sort());
    });
    it(`${locale} : aucun texte vide`, () => {
      expect(Object.entries(dict).filter(([, v]) => !v.trim())).toEqual([]);
    });
    it(`${locale} : mêmes variables {…} que l'anglais`, () => {
      const wrong = Object.keys(reference).filter((k) => placeholders(dict[k]) !== placeholders(reference[k]));
      expect(wrong).toEqual([]);
    });
  }
});

describe("choix de la langue", () => {
  it("cookie prioritaire", () => expect(pickLocale("de", "fr-FR,fr;q=0.9")).toBe("de"));
  it("navigateur ensuite", () => expect(pickLocale(undefined, "it-IT,it;q=0.9,en;q=0.8")).toBe("it"));
  it("respecte les priorités q", () => expect(pickLocale(undefined, "pt-BR;q=0.9,es;q=0.8,en;q=0.5")).toBe("es"));
  it("anglais par défaut", () => expect(pickLocale("xx", "pt-BR,ja")).toBe("en"));
  it("remplace les variables", () => expect(fmt("{n} comptes, {x}", { n: 3 })).toBe("3 comptes, {x}"));
});
