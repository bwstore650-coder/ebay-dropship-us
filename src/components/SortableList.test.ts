import { describe, expect, it } from "vitest";
import { moveItem } from "./SortableList";

describe("moveItem (glisser-déposer)", () => {
  it("déplace un élément vers le haut ou le bas sans modifier la liste d'origine", () => {
    const list = ["a", "b", "c", "d"];
    expect(moveItem(list, 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveItem(list, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(list).toEqual(["a", "b", "c", "d"]);
  });
  it("ignore une position invalide", () => {
    const list = [1, 2];
    expect(moveItem(list, 0, 5)).toBe(list);
    expect(moveItem(list, 1, 1)).toBe(list);
  });
});
