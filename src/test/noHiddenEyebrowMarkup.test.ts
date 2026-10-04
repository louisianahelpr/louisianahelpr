/**
 * Q1129 — no page emits `.text-display-eyebrow`, a class that is
 * `display: none` app-wide (the 2026-07-25 "all eyebrows gone" decision).
 *
 * WHAT WAS WRONG (grep of src/, 2026-10-04): seven page call sites still wrote
 * a hidden eyebrow (NotFound, CompleteProfile, AccountBanned, PaymentSuccess x2,
 * EarningHistory, ReviewsTab). Dead markup, and not harmless: as the first
 * child of a Tailwind `space-y-*` stack, a display:none element still counts
 * for the `~` sibling selector, so it silently gave the next element its top
 * margin. Each removal keeps that margin as an explicit class so nothing moves.
 *
 * The one emitter left is EmptyState's `eyebrow` prop (and ErrorState, which
 * forwards a default): removing it changes the title's top gap by 0.5rem on
 * every empty/error state that passes one, which is its own decision (Q1288).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { walkSource } from "./helpers/walkSource";
import { blankComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "..", "..");
const SRC = join(REPO, "src");
/** Exact: the only file allowed to emit the class (Q1288). */
// @two-way src/test/noHiddenEyebrowMarkup.test.ts:stale allowlist entry ${f} no longer emits the class
const ALLOWED = ["src/components/ui/EmptyState.tsx"];

describe("Q1129: no page emits the display:none eyebrow class", () => {
  const files = walkSource([SRC]).filter(
    (f) => /\.tsx?$/.test(f) && !f.startsWith(join(SRC, "test") + "/") && !/\.test\.tsx?$/.test(f),
  );

  it("reads the app source", () => {
    expect(files.length).toBeGreaterThan(800);
  });

  it("only EmptyState still emits it", () => {
    const emitters = files
      .filter((f) => blankComments(readFileSync(f, "utf8")).includes("text-display-eyebrow"))
      .map((f) => relative(REPO, f))
      .sort();
    for (const f of ALLOWED)
      expect(emitters, `stale allowlist entry ${f} no longer emits the class: remove it (lower ALLOWED, Q1288)`).toContain(f);
    expect(emitters).toEqual(ALLOWED);
  });

  it("the class is still display:none, so emitting it is still dead", () => {
    const css = readFileSync(join(SRC, "index.css"), "utf8");
    const rule = css.slice(css.indexOf(".text-display-eyebrow {"), css.indexOf("}", css.indexOf(".text-display-eyebrow {")));
    expect(rule).toContain("display: none;");
  });
});

// @mutate src/pages/info/NotFound.tsx |           <div className="space-y-3"> |           <div className="space-y-3"><span className="text-display-eyebrow">x</span>
