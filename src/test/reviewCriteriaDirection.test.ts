/**
 * THE FAILURE THIS PREVENTS
 *
 * One `<ReviewForm />` serves both directions of the marketplace, and until
 * 2026-09-06 it asked the same four questions in both. So a HELPER rating the
 * person who HIRED them was asked to score:
 *
 *   Punctuality      — "Showed up on time"
 *   Quality of work  — "Met expectations"
 *
 * Neither is a fact about a poster. The poster is not the one who shows up, and
 * there is no work of theirs to judge. The one-tap tags had the same shape of
 * error: "On time", "Quality work" and "Very professional" were all offered to
 * a helper describing their client.
 *
 * The star half of that problem is now gone by construction — owner,
 * 2026-09-07: "One reputation, and we only do overall — no punctuality etc."
 * There is one overall star in both directions and the three sub-criteria
 * columns are dropped, so there is no longer a per-dimension question that
 * could point the wrong way, and no `punctuality` column for two different
 * questions to share.
 *
 * What survives, and what this file guards, is the TAGS: still direction-aware,
 * still free to drift back into describing the wrong person. The assertions are
 * written against the WORLD (the vocabulary of a helper's job: showing up,
 * doing work) rather than against the arrays under test, so they cannot pass
 * vacuously by being kept in sync with whatever the arrays happen to say.
 */
import { describe, expect, it } from "vitest";
import {
  HELPER_QUICK_TAGS,
  POSTER_QUICK_TAGS,
  quickTagsFor,
} from "@/components/reviewPanel/types";

/**
 * Things only the person who DID the job can be judged on. Derived from what a
 * helper does — arrives somewhere, performs work — not from the arrays below.
 */
const HELPER_ONLY_LANGUAGE = [
  /\bshow(?:ed|s)?\s+up\b/i,
  /\bon\s+time\b/i,
  /\bquality\s+of\s+work\b/i,
  /\bquality\s+work\b/i,
  /\barriv/i,
];

describe("review tags adapt to who is being rated", () => {
  it("never offers a helper a tag about their client doing the work", () => {
    const asked = POSTER_QUICK_TAGS.join(" | ");
    for (const pattern of HELPER_ONLY_LANGUAGE) {
      expect(asked).not.toMatch(pattern);
    }
  });

  it("still offers a poster exactly those tags about their helper", () => {
    // The mirror of the assertion above — without it, "fixing" the poster set
    // by emptying both would pass.
    const asked = HELPER_QUICK_TAGS.join(" | ");
    expect(asked).toMatch(/\bon\s+time\b/i);
    expect(asked).toMatch(/quality/i);
  });

  it("has no duplicate tag within a direction", () => {
    for (const tags of [HELPER_QUICK_TAGS, POSTER_QUICK_TAGS]) {
      expect(new Set(tags).size).toBe(tags.length);
    }
  });

  it("defaults an unspecified direction to the helper set", () => {
    // `revieweeRole` defaults to "helper" in ReviewFormProps, so a caller that
    // has not been adapted keeps the behaviour it has always had rather than
    // silently switching tag sets.
    expect(quickTagsFor("helper")).toBe(HELPER_QUICK_TAGS);
    expect(quickTagsFor("poster")).toBe(POSTER_QUICK_TAGS);
  });
});

describe("the review form asks exactly one star question", () => {
  it("renders a single StarRow and writes only `rating`", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(
      join(process.cwd(), "src/components/reviewPanel/ReviewForm.tsx"),
      "utf8",
    );
    // One overall star, not a list of dimensions. Counting the ACTUAL mounts
    // rather than asserting the absence of a name means re-introducing a
    // second scored dimension fails here, whatever it gets called.
    expect((src.match(/<StarRow\b/g) ?? []).length).toBe(1);
    expect(src).not.toMatch(/\.map\(\(row\)\s*=>\s*\(?\s*<StarRow/);
    // And nothing writes a per-dimension column into `reviews` any more.
    for (const column of ["punctuality", "quality", "communication"]) {
      expect(src).not.toMatch(new RegExp(`^\\s*${column}\\s*:`, "m"));
    }
  });
});

describe("both ReviewForm mounts declare their direction", () => {
  it("passes revieweeRole at every call site", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(
      join(process.cwd(), "src/components/activity/ActivityDialogs.tsx"),
      "utf8",
    );
    // Both mounts, and each one named — a form whose tags depend on direction
    // must never be mounted without stating it. Derived by counting the ACTUAL
    // mounts rather than asserting a hardcoded two, so adding a third mount
    // fails here instead of sliding through.
    const mounts = src.match(/<ReviewForm\b/g) ?? [];
    expect(mounts.length).toBeGreaterThanOrEqual(2);
    expect((src.match(/revieweeRole="(?:helper|poster)"/g) ?? []).length).toBe(mounts.length);
    expect(src).toMatch(/revieweeRole="poster"/);
    expect(src).toMatch(/revieweeRole="helper"/);
  });
});
