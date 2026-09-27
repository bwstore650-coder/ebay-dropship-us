import { describe, expect, it } from "vitest";
import { reviewInput, reviewSummary } from "./reviews";

const ok = { rating: 5, text: "Found three profitable products in my first week.", authorName: "Mike R.", consent: true };

describe("avis", () => {
  it("accepte un avis valide", () => expect(reviewInput.safeParse(ok).success).toBe(true));
  it("refuse sans consentement", () => expect(reviewInput.safeParse({ ...ok, consent: false }).success).toBe(false));
  it("refuse une note hors 1-5", () => {
    expect(reviewInput.safeParse({ ...ok, rating: 0 }).success).toBe(false);
    expect(reviewInput.safeParse({ ...ok, rating: 6 }).success).toBe(false);
    expect(reviewInput.safeParse({ ...ok, rating: 4.5 }).success).toBe(false);
  });
  it("refuse un texte trop court", () => expect(reviewInput.safeParse({ ...ok, text: "Super" }).success).toBe(false));
  it("moyenne", () => {
    expect(reviewSummary([])).toBeNull();
    expect(reviewSummary([5, 4, 4])).toEqual({ avg: "4.3", n: 3 });
    expect(reviewSummary([5])).toEqual({ avg: "5.0", n: 1 });
  });
});
