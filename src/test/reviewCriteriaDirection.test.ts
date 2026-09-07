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
 * there is no work of theirs to judge. The asymmetry ran backwards on top of
 * that: rating a helper gave one overall star plus tags, while rating a poster
 * — the direction with less to say — got the MORE detailed form.
 *
 * The tags had the same shape of error: "On time", "Quality work" and "Very
 * professional" were all offered to a helper describing their client.
 *
 * These assertions are written against the WORLD (the vocabulary of a helper's
 * job: showing up, doing work) rather than against the arrays under test, so
 * they cannot pass vacuously by being kept in sync with whatever the arrays
 * happen to say.
 */
import { describe, expect, it } from "vitest";
import {
  HELPER_CATEGORY_ROWS,
  HELPER_QUICK_TAGS,
  POSTER_CATEGORY_ROWS,
  POSTER_QUICK_TAGS,
  categoryRowsFor,
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

const textOf = (rows: { label: string; sublabel: string }[]) =>
  rows.map((r) => `${r.label} ${r.sublabel}`).join(" | ");

describe("review criteria adapt to who is being rated", () => {
  it("never asks a helper to rate their client on doing the work", () => {
    const asked = `${textOf(POSTER_CATEGORY_ROWS)} | ${POSTER_QUICK_TAGS.join(" | ")}`;
    for (const pattern of HELPER_ONLY_LANGUAGE) {
      expect(asked).not.toMatch(pattern);
    }
  });

  it("still asks a poster to rate their helper on exactly those things", () => {
    // The mirror of the assertion above — without it, "fixing" the poster form
    // by emptying both would pass.
    const asked = `${textOf(HELPER_CATEGORY_ROWS)} | ${HELPER_QUICK_TAGS.join(" | ")}`;
    expect(asked).toMatch(/\bon\s+time\b/i);
    expect(asked).toMatch(/quality/i);
  });

  it("keeps Overall required and every other dimension optional, both ways", () => {
    for (const rows of [HELPER_CATEGORY_ROWS, POSTER_CATEGORY_ROWS]) {
      expect(rows.filter((r) => r.required).map((r) => r.key)).toEqual(["rating"]);
      expect(rows[0].key).toBe("rating");
    }
  });

  it("writes only columns whose NAME still describes what was asked", () => {
    // Storage is unchanged and there is no migration: the poster form simply
    // does not ask `quality`, which persists as NULL — the value the column
    // already holds for any dimension a reviewer skipped. Overloading it to
    // mean "was the job as described" would poison every future average, since
    // `reviews` is keyed by reviewee and one account is both poster and helper.
    expect(POSTER_CATEGORY_ROWS.map((r) => r.key)).not.toContain("quality");
    // `punctuality` survives on the poster side because a poster's promptness
    // is real and consequential — their approval is what releases the escrowed
    // payout — so the column keeps meaning "were they prompt".
    expect(POSTER_CATEGORY_ROWS.map((r) => r.key)).toContain("punctuality");
    // Whatever each side asks, it can only ever land in a column that exists.
    const columns = new Set(["rating", "punctuality", "quality", "communication"]);
    for (const rows of [HELPER_CATEGORY_ROWS, POSTER_CATEGORY_ROWS]) {
      for (const row of rows) expect(columns.has(row.key)).toBe(true);
    }
  });

  it("asks a poster no more questions than it asks a helper", () => {
    // The original asymmetry: the less-informative direction had the longer
    // form. It must never be the longer one again.
    expect(POSTER_CATEGORY_ROWS.length).toBeLessThanOrEqual(HELPER_CATEGORY_ROWS.length);
  });

  it("has no duplicate dimension within a direction", () => {
    for (const rows of [HELPER_CATEGORY_ROWS, POSTER_CATEGORY_ROWS]) {
      expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    }
  });

  it("defaults an unspecified direction to the helper set", () => {
    // `revieweeRole` defaults to "helper" in ReviewFormProps, so a caller that
    // has not been adapted keeps the behaviour it has always had rather than
    // silently switching question sets.
    expect(categoryRowsFor("helper")).toBe(HELPER_CATEGORY_ROWS);
    expect(categoryRowsFor("poster")).toBe(POSTER_CATEGORY_ROWS);
    expect(quickTagsFor("helper")).toBe(HELPER_QUICK_TAGS);
    expect(quickTagsFor("poster")).toBe(POSTER_QUICK_TAGS);
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
    // Both mounts, and each one named — a form whose questions depend on
    // direction must never be mounted without stating it. Derived by counting
    // the ACTUAL mounts rather than asserting a hardcoded two, so adding a
    // third mount fails here instead of sliding through.
    const mounts = src.match(/<ReviewForm\b/g) ?? [];
    expect(mounts.length).toBeGreaterThanOrEqual(2);
    expect((src.match(/revieweeRole="(?:helper|poster)"/g) ?? []).length).toBe(mounts.length);
    expect(src).toMatch(/revieweeRole="poster"/);
    expect(src).toMatch(/revieweeRole="helper"/);
  });
});
