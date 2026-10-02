import { describe, expect, it, vi } from "vitest";
import type { AspectDef } from "./ebay";
import { buildAspects, cleanImages, cleanTitle, ebayItemUrl, makeSku, mostCommon, sanitizeDescription, veroIn } from "./listing";

const def = (name: string, o: Partial<AspectDef> = {}): AspectDef => ({ name, required: false, mode: "FREE_TEXT", multi: false, values: [], ...o });

describe("annonce : SKU et titre", () => {
  it("SKU unique et court", () => {
    const a = makeSku(1790000000000, () => 0.5);
    expect(a).toMatch(/^PL-[0-9A-Z]+-[0-9A-Z]{6}$/);
    expect(a.length).toBeLessThanOrEqual(50);
    expect(makeSku(1, () => 0.1)).not.toBe(makeSku(1, () => 0.2));
  });
  it("titre ≤ 80 caractères coupé sur un mot", () => {
    const long = "Electric Can Opener Automatic Hands Free Smooth Edge Battery Operated Kitchen Tool for Seniors and Arthritis";
    const t = cleanTitle(long);
    expect(t.length).toBeLessThanOrEqual(80);
    expect(long.startsWith(t)).toBe(true);
    expect(t.endsWith(" ")).toBe(false);
  });
  it("titre court inchangé, espaces normalisés", () => expect(cleanTitle("  Can   opener <b> ")).toBe("Can opener b"));
});

describe("annonce : description", () => {
  it("retire scripts, liens, attributs actifs", () => {
    const d = sanitizeDescription('<p onclick="x()">Hi <a href="https://evil.com">site</a></p><script>alert(1)</script><img src="a.jpg"><iframe src="x"></iframe>');
    expect(d).toBe("<p>Hi site</p>");
  });
  it("tronque au-delà de 4000 caractères", () => {
    const d = sanitizeDescription(`<p>${"word ".repeat(2000)}</p>`);
    expect(d.length).toBeLessThanOrEqual(4000);
    expect(d.startsWith("<p>word")).toBe(true);
  });
});

describe("annonce : caractéristiques", () => {
  const defs = [
    def("Brand", { required: true }),
    def("Type", { required: true, mode: "SELECTION_ONLY", values: ["Electric", "Manual"] }),
    def("Color", { multi: true }),
    def("Power Source", { required: true }),
  ];
  it("force la marque « Unbranded », respecte les valeurs imposées et signale les manquantes", () => {
    const r = buildAspects({ brand: "Nike", type: "electric", Color: ["Black", "Black", "White"] }, defs, "EBAY_US");
    expect(r.aspects).toEqual({ Brand: ["Unbranded"], Type: ["Electric"], Color: ["Black", "White"] });
    expect(r.missingRequired).toEqual(["Power Source"]);
  });
  it("valeur hors liste retirée", () => {
    const r = buildAspects({ Type: "Nuclear" }, defs, "EBAY_US");
    expect(r.aspects.Type).toBeUndefined();
    expect(r.missingRequired).toContain("Type");
  });
  it("marque dans la langue du pays", () => {
    expect(buildAspects({}, [def("Marke", { required: true })], "EBAY_DE").aspects).toEqual({ Marke: ["Markenlos"] });
    expect(buildAspects({}, [], "EBAY_FR").aspects).toEqual({ Marque: ["Sans marque"] });
  });
  it("une seule valeur si l'aspect n'est pas multiple, valeurs ≤ 50 caractères", () => {
    const r = buildAspects({ "Power Source": ["Battery", "USB"], Material: "x".repeat(80) }, defs, "EBAY_US");
    expect(r.aspects["Power Source"]).toEqual(["Battery"]);
    expect(r.aspects.Material[0].length).toBe(50);
  });
  it("détecte une marque protégée", () => {
    expect(veroIn("Case for Apple iPhone", {})).toBe("apple");
    expect(veroIn("Phone case", { Compatible: ["Samsung Galaxy"] })).toBe("samsung");
    expect(veroIn("Phone case", { Brand: ["Unbranded"] })).toBeNull();
  });
});

describe("annonce : divers", () => {
  it("catégorie la plus fréquente", () => {
    expect(mostCommon(["1", "2", "2", undefined, "3"])).toBe("2");
    expect(mostCommon([])).toBeNull();
  });
  it("images https, sans doublon", () => {
    expect(cleanImages(["http://a.com/1.jpg", "https://a.com/1.jpg", "ftp://x", null, "https://b.com/2.png"])).toEqual(["https://a.com/1.jpg", "https://b.com/2.png"]);
  });
  it("lien eBay du bon pays", () => {
    expect(ebayItemUrl("EBAY_DE", "123")).toBe("https://www.ebay.de/itm/123");
    expect(ebayItemUrl("EBAY_GB", "9")).toBe("https://www.ebay.co.uk/itm/9");
    vi.stubEnv("EBAY_ENV", "sandbox");
    expect(ebayItemUrl("EBAY_US", "110590823028")).toBe("https://sandbox.ebay.com/itm/110590823028");
    vi.unstubAllEnvs();
  });
});

describe("annonces à variantes : options", () => {
  it("noms et valeurs CJ associés un à un, noms usuels normalisés", async () => {
    const { variantOptions } = await import("./listing");
    expect(variantOptions("Format-Quantity", "L-1PCS", "L-1PCS")).toEqual({ Format: "L", Quantity: "1PCS" });
    expect(variantOptions("colour-size", "Black-XL", "x")).toEqual({ Color: "Black", Size: "XL" });
    // Valeur qui contient un tiret : une seule option.
    expect(variantOptions("Size", "1-2 years", "1-2 years")).toEqual({ Size: "1-2 years" });
    expect(variantOptions(undefined, undefined, "Big pack")).toEqual({ Option: "Big pack" });
    expect(variantOptions("Color-Size", "Red", "Red")).toEqual({ Option: "Red" });
  });
  it("ce qui varie : mêmes options partout, pas de doublon, 5 options au plus", async () => {
    const { variationSpecs, withoutVariationAspects } = await import("./listing");
    expect(variationSpecs([{ Size: "S", Pack: "1" }, { Size: "M", Pack: "1" }, { Size: "S", Pack: "2" }])).toEqual([
      { name: "Size", values: ["S", "M"] }, { name: "Pack", values: ["1", "2"] },
    ]);
    expect(variationSpecs([{ Size: "S" }, { Size: "s" }])).toBeNull(); // doublon
    expect(variationSpecs([{ Size: "S" }, { Color: "Red" }])).toBeNull(); // options différentes
    expect(variationSpecs([])).toBeNull();
    expect(withoutVariationAspects({ Size: ["M"], Brand: ["Unbranded"], color: ["Red"] }, ["Size", "Color"])).toEqual({ Brand: ["Unbranded"] });
  });
});
