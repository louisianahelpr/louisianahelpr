import { describe, it, expect } from "vitest";
import { cn, formatName } from "./utils";
import tailwindConfig from "../../tailwind.config";

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

// ---------------------------------------------------------------------------
// INVENTORY, NOT SPOT-CHECKS.
//
// The five tests above prove the mechanism on four hand-picked classes
// (ds-10/12/14/24 and rounded-ds-md). That is exactly the shape that lets the
// next `ds-*` token ship broken: DS_FONT_SIZES and DS_RADII in src/lib/utils.ts
// are hand-typed mirrors of tailwind.config.ts, and a scale entry added to the
// config but not to the mirror silently rejoins the text-COLOUR group — the
// original 2.21:1 Badge defect, class intact, on a token nobody wrote a
// spot-check for.
//
// So derive the inventory from the config itself and assert every member.
// tailwind.config.ts is the source Tailwind actually compiles from, so it
// cannot be the test's own copy of production logic.
// ---------------------------------------------------------------------------
const tailwindTheme = (tailwindConfig as { theme?: { extend?: Record<string, unknown> } }).theme
  ?.extend ?? {};
const dsKeys = (group: string) =>
  Object.keys((tailwindTheme[group] ?? {}) as Record<string, unknown>).filter((k) =>
    k.startsWith("ds-"),
  );

describe("cn — every ds-* token in tailwind.config.ts is known to tailwind-merge", () => {
  const fontSizes = dsKeys("fontSize");
  const radii = dsKeys("borderRadius");

  it("found the scales to iterate (inventory floor)", () => {
    // Without a floor, a config-shape change that yielded [] would make the
    // two loops below iterate zero times and report success.
    expect(fontSizes.length).toBeGreaterThanOrEqual(17);
    expect(radii.length).toBeGreaterThanOrEqual(5);
  });

  it("no ds font size eats a text colour", () => {
    for (const key of fontSizes) {
      const out = cn("text-primary-foreground", `text-${key}`);
      expect(out, `text-${key} is missing from DS_FONT_SIZES in src/lib/utils.ts`).toContain(
        "text-primary-foreground",
      );
      expect(out).toContain(`text-${key}`);
    }
  });

  it("every ds font size still overrides another ds font size", () => {
    // The other half: an unknown `text-ds-*` would ALSO stop conflicting with
    // its own group, so "keeps the colour" alone cannot tell known from
    // unknown. Pair it with a same-group override.
    for (const key of fontSizes) {
      if (key === "ds-9") continue;
      const out = cn("text-ds-9", `text-${key}`);
      expect(out, `text-${key} is not in the font-size group`).not.toContain("text-ds-9");
    }
  });

  it("every ds radius dedupes against Tailwind's own rounded scale", () => {
    for (const key of radii) {
      const out = cn("rounded-md", `rounded-${key}`);
      expect(out, `rounded-${key} is missing from DS_RADII in src/lib/utils.ts`).not.toContain(
        "rounded-md",
      );
      expect(out).toContain(`rounded-${key}`);
    }
  });
});

// Drops one ds-* token from tailwind-merge's font-size group. `text-ds-24`
// rejoins the text-COLOUR group, so it starts eating the colour beside it —
// the 2.21:1 Badge defect, invisible in the markup. The derived-inventory
// test above is what catches it; the spot-checks catch this one too, which is
// the point of pairing them.
// @mutate src/lib/utils.ts | "ds-17", "ds-18", "ds-20", "ds-22", "ds-24", "ds-26", "ds-28", "ds-32", | "ds-17", "ds-18", "ds-20", "ds-22", "ds-26", "ds-28", "ds-32",
//
// SECOND MUTATION — proves the derived inventory, not the spot-checks. It adds
// a `ds-*` font size to tailwind.config.ts (a real design-system change) and
// leaves DS_FONT_SIZES alone, which is precisely how `text-ds-10` came to eat
// `text-primary-foreground` on <Badge>. The five hand-picked spot-checks above
// are all still green under this one.
// @mutate tailwind.config.ts | "ds-40": ["40px", { lineHeight: "1.1", letterSpacing: "-0.02em" }], | "ds-40": ["40px", { lineHeight: "1.1", letterSpacing: "-0.02em" }], "ds-44": ["44px", { lineHeight: "1.1", letterSpacing: "-0.02em" }],
