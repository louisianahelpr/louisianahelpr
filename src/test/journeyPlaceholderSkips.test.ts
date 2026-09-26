/*
 * CLASS GUARD: a journey test that can only ever skip is a to-do, not a test,
 * and it keeps the whole nightly red.
 *
 * nightly-red #1719 (e2e-journeys, red on every run since 2026-09-23): five
 * tests in e2e/journeys/time-travel.spec.ts had a body of ONE statement,
 * `skipUncovered(...)`. Nothing seeded or looked for their state and no secret
 * was missing, so they skipped on every run in both engines, and since Q52 the
 * skip reporter counts each as a failure. The workflow could not go green
 * whatever else was fixed, and a real regression in it (the Reviewed badge)
 * sat behind a red that had already been acknowledged.
 *
 * Three of them now run: the funded countdown chip in time-travel.spec.ts, and
 * "Offer expiring" / "Review window" as "time travel:" steps of
 * 02-marketplace.spec.ts, which holds exactly the state they need.
 *
 * THE RULE, inventory from source: every UNCONDITIONAL placeholder in
 * e2e/journeys (a test whose body starts with `skipUncovered(`, including the
 * `for (const [title, detail] of [...])` form) is listed in PLACEHOLDER_KNOWN
 * below, and every entry there still exists. Two-way: a new placeholder fails,
 * and building one of the listed legs fails until its entry is removed. The
 * moved legs are held in place by a floor on the "time travel:" steps.
 */

// @mutate e2e/journeys/time-travel.spec.ts | ["Subscription expiring", "neither | ["Offer expiring", "placeholder"],\n    ["Subscription expiring", "neither
// @mutate e2e/journeys/02-marketplace.spec.ts | test.step("time travel: the offer counts down to its deadline, then is gone" | test.step("the offer counts down to its deadline, then is gone"
// @mutate e2e/journeys/time-travel.spec.ts | test("a funded job's countdown chip: | test.skip("a funded job's countdown chip:

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const root = join(__dirname, "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.spec\.ts$/.test(name)) out.push(p);
  }
  return out;
}

/**
 * The two time-travel legs no journey can reach yet (docs/OPEN.md carries
 * both): an accepted job the Helpr has not confirmed, and a paid membership.
 */
// @two-way src/test/journeyPlaceholderSkips.test.ts:a placeholder listed here no longer exists
const PLACEHOLDER_KNOWN = [
  "e2e/journeys/time-travel.spec.ts :: Confirm window (day before / day of)",
  "e2e/journeys/time-travel.spec.ts :: Subscription expiring",
];

export function placeholders(rel: string, src: string): string[] {
  const code = blankComments(src);
  const out: string[] = [];
  // Direct form: test("title", async (...) => { skipUncovered(
  for (const m of code.matchAll(/\btest\(\s*(["'`])((?:(?!\1).)*)\1\s*,\s*async\s*\([^)]*\)\s*=>\s*\{\s*skipUncovered\(/g)) {
    if (!m[2].includes("${")) out.push(`${rel} :: ${m[2]}`);
  }
  // Loop form: for (const [title, …] of [["A", …], ["B", …]] as const) { test(`…${title}`, async () => { skipUncovered(
  for (const m of code.matchAll(/for \(const \[(\w+)[^\]]*\] of \[([\s\S]*?)\] as const\) \{\s*test\(`[^`]*\$\{\1\}[^`]*`\s*,\s*async\s*\([^)]*\)\s*=>\s*\{\s*skipUncovered\(/g)) {
    for (const t of m[2].matchAll(/\[\s*"([^"]+)"/g)) out.push(`${rel} :: ${t[1]}`);
  }
  return out;
}

describe("no journey test is a placeholder that can only skip", () => {
  const files = walk(join(root, "e2e/journeys")).map((p) => ({ rel: relative(root, p), src: readFileSync(p, "utf8") }));
  const found = files.flatMap((f) => placeholders(f.rel, f.src)).sort();

  it("the scan reads the journeys and recognises the placeholder shape (floors)", () => {
    expect(files.length).toBeGreaterThan(5);
    // The detector is proven on both shapes, so an empty result means none, not a blind scan.
    expect(placeholders("x", 'test("a", async () => { skipUncovered("t", "d"); });')).toEqual(["x :: a"]);
    expect(
      placeholders("x", 'for (const [title, detail] of [\n ["A", "d"],\n ["B", "e"],\n] as const) {\n test(`U: ${title}`, async () => {\n skipUncovered(title, detail);')
    ).toEqual(["x :: A", "x :: B"]);
  });

  it("every unconditional placeholder is known, and every known one still exists", () => {
    const unknown = found.filter((k) => !PLACEHOLDER_KNOWN.includes(k));
    expect(unknown, "a journey test that can only skip: build the leg, or put it in docs/OPEN.md and list it here").toEqual([]);
    const stale = PLACEHOLDER_KNOWN.filter((k) => !found.includes(k));
    expect(stale, "a placeholder listed here no longer exists: remove its entry (lower the list)").toEqual([]);
  });

  it("the legs that left the placeholder list run where their state is", () => {
    const market = blankComments(readFileSync(join(root, "e2e/journeys/02-marketplace.spec.ts"), "utf8"));
    const steps = market.match(/test\.step\("time travel: /g) ?? [];
    expect(steps.length).toBeGreaterThan(1);
    const tt = blankComments(readFileSync(join(root, "e2e/journeys/time-travel.spec.ts"), "utf8"));
    expect(tt).toMatch(/\btest\("a funded job's countdown chip:/);
    expect(tt).toMatch(/await payCheckoutUrlInChromium\(/);
  });
});
