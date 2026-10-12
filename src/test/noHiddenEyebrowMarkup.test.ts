/**
 * Q1129 — no page emits `.text-display-eyebrow`, a class that was
 * `display: none` app-wide (the 2026-07-25 "all eyebrows gone" decision).
 *
 * WHAT WAS WRONG (grep of src/, 2026-10-04): seven page call sites still wrote
 * a hidden eyebrow (NotFound, CompleteProfile, AccountBanned, PaymentSuccess x2,
 * EarningHistory, ReviewsTab). Dead markup, and not harmless: as the first
 * child of a Tailwind `space-y-*` stack, a display:none element still counts
 * for the `~` sibling selector, so it silently gave the next element its top
 * margin. Each removal keeps that margin as an explicit class so nothing moves.
 *
 * The last emitter was EmptyState's `eyebrow` prop (and ErrorState, which
 * forwarded a default). The owner chose to drop it (2026-10-12, Q1288): the
 * prop, its callers and the CSS rule are gone, so NO file emits the class and
 * the rule no longer exists. The title gap it caused is guarded by
 * src/test/emptyStateTitleGap.test.tsx.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { walkSource } from "./helpers/walkSource";
import { blankComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "..", "..");
const SRC = join(REPO, "src");

describe("Q1129: no page emits the dead eyebrow class", () => {
  const files = walkSource([SRC]).filter(
    (f) => /\.tsx?$/.test(f) && !f.startsWith(join(SRC, "test") + "/") && !/\.test\.tsx?$/.test(f),
  );

  it("reads the app source", () => {
    expect(files.length).toBeGreaterThan(800);
  });

  it("no file emits it (EmptyState's eyebrow was the last, removed 2026-10-12, Q1288)", () => {
    const emitters = files
      .filter((f) => blankComments(readFileSync(f, "utf8")).includes("text-display-eyebrow"))
      .map((f) => relative(REPO, f))
      .sort();
    expect(emitters).toEqual([]);
  });

  it("the dead rule is gone too (Q1288), so the class styles nothing anywhere", () => {
    const css = blankComments(readFileSync(join(SRC, "index.css"), "utf8"));
    expect(css.length).toBeGreaterThan(10_000);
    expect(css).not.toContain(".text-display-eyebrow");
  });
});

// @mutate src/pages/info/NotFound.tsx |           <div className="space-y-3"> |           <div className="space-y-3"><span className="text-display-eyebrow">x</span>
// @mutate src/components/ui/EmptyState.tsx |           {title && ( |           <span className="text-display-eyebrow">x</span>{title && (
// @mutate src/index.css | .scrollbar-hide::-webkit-scrollbar { | .text-display-eyebrow { display: none; } .scrollbar-hide::-webkit-scrollbar {
