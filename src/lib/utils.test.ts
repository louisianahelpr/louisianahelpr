import { describe, it, expect } from "vitest";
import { formatName } from "./utils";

describe("formatName", () => {
  it("formats first + last as 'First L.'", () => {
    expect(formatName("Lexi Lombas")).toBe("Lexi L.");
    expect(formatName("Marie Beaumont")).toBe("Marie B.");
  });

  it("handles 3+ name parts by using FIRST + LAST initial", () => {
    expect(formatName("Mary Anne Beaumont")).toBe("Mary B.");
    expect(formatName("Jean-Pierre De La Croix")).toBe("Jean-Pierre C.");
  });

  it("returns just the first name when only one word given", () => {
    expect(formatName("Madonna")).toBe("Madonna");
  });

  it("falls back to fallback when name is null/empty/whitespace", () => {
    expect(formatName(null)).toBe("User");
    expect(formatName(undefined)).toBe("User");
    expect(formatName("")).toBe("User");
    expect(formatName("   ")).toBe("User");
  });

  it("uses the custom fallback if provided", () => {
    expect(formatName(null, "Anonymous")).toBe("Anonymous");
    expect(formatName("", "Helpr")).toBe("Helpr");
  });

  it("collapses multiple spaces between names", () => {
    expect(formatName("Lexi   Lombas")).toBe("Lexi L.");
  });
});
