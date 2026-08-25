import { describe, it, expect } from "vitest";
import { cn, formatName } from "./utils";

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
    expect(formatName(null)).toBe("A neighbor");
    expect(formatName(undefined)).toBe("A neighbor");
    expect(formatName("")).toBe("A neighbor");
    expect(formatName("   ")).toBe("A neighbor");
  });

  it("uses the custom fallback if provided", () => {
    expect(formatName(null, "Anonymous")).toBe("Anonymous");
    expect(formatName("", "Helpr")).toBe("Helpr");
  });

  it("collapses multiple spaces between names", () => {
    expect(formatName("Lexi   Lombas")).toBe("Lexi L.");
  });
});

// `cn()` merges Tailwind classes. The bug this guards against was invisible in
// the markup: tailwind-merge ships only Tailwind's DEFAULT font-size scale, so
// it read the custom `text-ds-10` as a text COLOUR (its fallback for an
// unrecognised `text-*`) and dropped whatever colour came before it.
//
// On a <Badge>, whose variant supplies `text-primary-foreground`, adding
// `className="text-ds-10"` therefore deleted the foreground colour — the
// a dark pill on an olive surface measured 2.21:1 against its own background,
// a WCAG AA failure, with nothing in the JSX to suggest a colour was lost.
describe("cn — ds-* type scale vs tailwind-merge", () => {
  it("keeps a text colour and a ds font size together", () => {
    const out = cn("text-primary-foreground", "text-ds-10");
    expect(out).toContain("text-primary-foreground");
    expect(out).toContain("text-ds-10");
  });

  it("keeps them together regardless of order", () => {
    const out = cn("text-ds-14", "text-muted-foreground");
    expect(out).toContain("text-ds-14");
    expect(out).toContain("text-muted-foreground");
  });

  it("still lets one ds size override another", () => {
    // The whole point of teaching it the scale: these DO conflict.
    const out = cn("text-ds-10", "text-ds-24");
    expect(out).toContain("text-ds-24");
    expect(out).not.toContain("text-ds-10");
  });

  it("still lets one text colour override another", () => {
    const out = cn("text-primary-foreground", "text-muted-foreground");
    expect(out).toContain("text-muted-foreground");
    expect(out).not.toContain("text-primary-foreground");
  });

  it("does not treat ds radii as font sizes", () => {
    // ds-md/ds-pill live under borderRadius, not fontSize — a rounded-* class
    // must be unaffected by the font-size group.
    const out = cn("rounded-ds-md", "text-ds-12", "text-primary-foreground");
    expect(out).toContain("rounded-ds-md");
    expect(out).toContain("text-ds-12");
    expect(out).toContain("text-primary-foreground");
  });
});
