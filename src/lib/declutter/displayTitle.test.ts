/**
 * Owner 11-20 (Declutter item page polish #7): display-only smart title case.
 * @mutate src/lib/declutter/displayTitle.ts |       if (i !== first && i !== last && SMALL.has(m[2])) return t; |       if (SMALL.has(m[2])) return t;
 * @mutate src/lib/declutter/displayTitle.ts |   return /^\p{Ll}+$/u.test(part) ? part.charAt(0).toUpperCase() + part.slice(1) : part; |   return part;
 */
import { describe, expect, it } from "vitest";
import { displayTitle } from "./displayTitle";

describe("displayTitle", () => {
  it("title-cases the owner's example", () => {
    expect(displayTitle("Vintage duck touch Lamp")).toBe("Vintage Duck Touch Lamp");
  });
  it("leaves all-caps and mixed-case brand words exactly as typed", () => {
    expect(displayTitle("iPhone 12 case")).toBe("iPhone 12 Case");
    expect(displayTitle("OK Lighting floor lamp")).toBe("OK Lighting Floor Lamp");
    expect(displayTitle("LSU tumbler by YETI")).toBe("LSU Tumbler by YETI");
    expect(displayTitle("McCoy pottery vase")).toBe("McCoy Pottery Vase");
  });
  it("keeps short joining words lowercase inside, never first or last", () => {
    expect(displayTitle("box of toys and games")).toBe("Box of Toys and Games");
    expect(displayTitle("the end")).toBe("The End");
    expect(displayTitle("stuff to play with")).toBe("Stuff to Play With");
  });
  it("cases hyphenated words part by part and keeps punctuation, digits and spacing", () => {
    expect(displayTitle("mid-century  chair, oak")).toBe("Mid-Century  Chair, Oak");
    expect(displayTitle("3-piece set (new)")).toBe("3-piece Set (New)");
    expect(displayTitle("crème brûlée torch")).toBe("Crème Brûlée Torch");
  });
  it("handles empty input", () => {
    expect(displayTitle("")).toBe("");
    expect(displayTitle(null)).toBe("");
    expect(displayTitle("   ")).toBe("   ");
  });
});
