import { describe, expect, it } from "vitest";
import { sign } from "./aliexpress";

describe("signature AliExpress", () => {
  it("trie les paramètres et signe en HMAC-SHA256 majuscule", () => {
    const s = sign({ b: "2", a: "1" }, "secret");
    expect(s).toMatch(/^[0-9A-F]{64}$/);
    // même résultat quel que soit l'ordre d'entrée
    expect(sign({ a: "1", b: "2" }, "secret")).toBe(s);
  });
  it("place le chemin devant pour les API /rest", () => {
    expect(sign({ a: "1" }, "secret", "/auth/token/create")).not.toBe(sign({ a: "1" }, "secret"));
  });
});
