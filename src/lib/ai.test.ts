import { afterEach, describe, expect, it, vi } from "vitest";
import { htmlToText, writeListingCopy } from "./ai";

const input = {
  language: "en" as const,
  supplierTitle: "Electric Can Opener",
  supplierDescription: "Material: ABS\nPower: 4 x AA batteries",
  comparableTitles: ["Automatic Can Opener Electric"],
  aspects: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("IA annonce", () => {
  it("texte brut depuis le HTML fournisseur", () => {
    expect(htmlToText("<p>Hello&nbsp;<b>world</b></p><script>x</script><ul><li>A</li><li>B</li></ul>")).toBe("Hello world\nA\nB");
  });
  it("sans clé : texte du fournisseur", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const r = await writeListingCopy(input);
    expect(r.source).toBe("supplier");
    expect(r.descriptionHtml).toBe("<ul><li>Material: ABS</li><li>Power: 4 x AA batteries</li></ul>");
  });
  it("avec clé : lit la réponse de l'outil", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: "tool_use", input: { title: "Automatic Electric Can Opener", description_html: "<p>Opens cans easily.</p>", aspects: { Type: ["Electric"] } } }] })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const r = await writeListingCopy(input);
    expect(r).toEqual({ title: "Automatic Electric Can Opener", descriptionHtml: "<p>Opens cans easily.</p>", aspects: { Type: ["Electric"] }, source: "ai" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.tool_choice).toEqual({ type: "tool", name: "save_listing" });
  });
  it("erreur de l'API : repli sur le fournisseur", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("oops", { status: 500 })));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await writeListingCopy(input)).source).toBe("supplier");
  });
});
