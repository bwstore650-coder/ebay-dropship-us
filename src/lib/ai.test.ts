import { afterEach, describe, expect, it, vi } from "vitest";
import { htmlToText, safeTitles, writeDescription, writeListingCopy, writeTitles } from "./ai";

const input = {
  language: "en" as const,
  supplierTitle: "Electric Can Opener",
  supplierDescription: "Material: ABS\nPower: 4 x AA batteries",
  comparableTitles: ["Automatic Can Opener Electric"],
  aspects: [],
};
const reply = (toolInput: unknown) => vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: [{ type: "tool_use", input: toolInput }] })));

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
    expect(r).toMatchObject({ source: "supplier", title: "Electric Can Opener", titles: ["Electric Can Opener"] });
    expect(r.descriptionHtml).toBe("<ul><li>Material: ABS</li><li>Power: 4 x AA batteries</li></ul>");
  });
  it("avec clé : 3 titres, les marques protégées sont écartées", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    const fetchMock = reply({
      titles: ["Automatic Electric Can Opener Hands Free", "Can Opener for Apple Lovers Electric", "Electric Can Opener Smooth Edge Battery"],
      description_html: "<p>Opens cans easily.</p>",
      aspects: { Type: ["Electric"] },
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await writeListingCopy(input);
    expect(r).toEqual({
      title: "Automatic Electric Can Opener Hands Free",
      titles: ["Automatic Electric Can Opener Hands Free", "Electric Can Opener Smooth Edge Battery"],
      descriptionHtml: "<p>Opens cans easily.</p>",
      aspects: { Type: ["Electric"] },
      source: "ai",
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.tool_choice).toEqual({ type: "tool", name: "save_listing" });
    expect(body.messages[0].content).toContain("NEVER mention a brand");
  });
  it("erreur de l'API : repli sur le fournisseur", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("oops", { status: 500 })));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await writeListingCopy(input)).source).toBe("supplier");
  });
});

describe("IA titres et description", () => {
  it("titres sûrs : ≤ 80 caractères, sans symboles, sans marque, sans doublon", () => {
    const long = "Electric Can Opener Automatic Hands Free Smooth Edge Battery Powered Kitchen Tool For Seniors";
    const r = safeTitles([long, "Electric can opener!!!", "ELECTRIC CAN OPENER", "Case for AirPods Pro", "short", 42]);
    expect(r[0].length).toBeLessThanOrEqual(80);
    expect(r).toContain("Electric can opener");
    expect(r.filter((t) => t.toLowerCase() === "electric can opener")).toHaveLength(1);
    expect(r.some((t) => /airpods/i.test(t))).toBe(false);
  });
  it("titres seuls : mots qui vendent et titre actuel envoyés à l'IA", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    const fetchMock = reply({ titles: ["Electric Can Opener Automatic One Touch", "Hands Free Can Opener Electric Kitchen", "Battery Can Opener Smooth Edge Automatic"] });
    vi.stubGlobal("fetch", fetchMock);
    const t = await writeTitles({ language: "fr", productTitle: "can opener", keywords: ["electric", "automatic"], currentTitle: "Old title here" });
    expect(t).toHaveLength(3);
    const prompt = JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content as string;
    expect(prompt).toContain("Write in French");
    expect(prompt).toContain("electric, automatic");
    expect(prompt).toContain("Old title here");
  });
  it("aucun titre utilisable (que des marques) : erreur", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    vi.stubGlobal("fetch", reply({ titles: ["Nike Running Socks Pack", "Adidas style socks"] }));
    await expect(writeTitles({ language: "en", productTitle: "socks" })).rejects.toThrow();
  });
  it("description seule", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    vi.stubGlobal("fetch", reply({ description_html: "<h3>Can opener</h3><p>Opens cans in seconds.</p>" }));
    expect(await writeDescription({ language: "en", productTitle: "Can opener", facts: "ABS, 4 AA batteries" })).toContain("<h3>");
  });
  it("sans clé : erreur explicite (pas d'appel)", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await expect(writeTitles({ language: "en", productTitle: "x" })).rejects.toThrow("AI_NOT_CONFIGURED");
    expect(f).not.toHaveBeenCalled();
  });
});
