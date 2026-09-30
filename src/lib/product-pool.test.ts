import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/crypto", () => ({ decrypt: (s: string) => s }));

import { normTitle } from "./product-pool";

describe("doublons de la base", () => {
  it("les variantes de couleur comptent comme un seul produit", () => {
    const a = normTitle("24V 350W Electric Dirt Bike Up to 15 MPH w/ Twist Grip Throttle, Blue");
    expect(normTitle("24V 350W Electric Dirt Bike Up to 15 MPH w/ Twist Grip Throttle, Pink")).toBe(a);
    expect(normTitle("24V 350W Electric Dirt Bike Up to 15 MPH w/ Twist Grip Throttle, Green")).toBe(a);
    expect(normTitle("36V 500W Electric Dirt Bike Up to 20 MPH, Blue")).not.toBe(a);
  });
});
