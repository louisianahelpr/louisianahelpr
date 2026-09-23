/**
 * TWO-WAY check for EXEMPT_PARENTS in e2e/happy-path/buttonGeometry.ts.
 *
 * That list excuses parents whose children differ in height BY DESIGN from the
 * sibling-height rule, matched by accessible name. The rule itself only runs in
 * a browser sweep, where an exemption that matches nothing is invisible: the
 * sweep just never meets that parent. So staleness is checked here, statically,
 * on the one thing an entry depends on — the accessible name it matches must
 * still be rendered somewhere in src/. An entry whose name no longer exists is
 * excusing nothing, and would silently excuse whatever next wears that name.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { walkSource } from "./helpers/walkSource";

const REPO = resolve(__dirname, "../..");

/** The `sel:` strings inside the EXEMPT_PARENTS literal. */
export function exemptSelectors(src: string): string[] {
  const start = src.indexOf("const EXEMPT_PARENTS");
  if (start < 0) return [];
  const end = src.indexOf("];", start);
  const block = src.slice(start, end);
  return [...block.matchAll(/sel:\s*(['"`])(.*?)\1/g)].map((m) => m[2]);
}

describe("buttonGeometry EXEMPT_PARENTS is two-way", () => {
  const sels = exemptSelectors(readFileSync(join(REPO, "e2e/happy-path/buttonGeometry.ts"), "utf8"));

  it("finds the list (an unparsed list would pass vacuously)", () => {
    expect(sels.length).toBeGreaterThanOrEqual(1);
  });

  it("every exempt parent's accessible name is still rendered in src/", () => {
    const tsx = walkSource([join(REPO, "src")], [".tsx"])
      .filter((f) => !/\.test\.tsx$/.test(f))
      .map((f) => readFileSync(f, "utf8"));
    const staleSels = sels.filter((sel) => {
      const name = /aria-label="([^"]+)"/.exec(sel)?.[1];
      if (!name) return true; // not matchable by name — the list's own rule says it must be
      return !tsx.some((src) => src.includes(`aria-label="${name}"`) || src.includes(`aria-label={"${name}"}`));
    });
    expect(staleSels.map((s) => `stale baseline entry ${s} — remove it (lower the baseline)`)).toEqual([]);
  });
});

// Renaming the exempt strip must turn the entry stale.
// @mutate src/components/profile/HelperScheduleStrip.tsx | aria-label="Upcoming 7 days" | aria-label="Next 7 days"
