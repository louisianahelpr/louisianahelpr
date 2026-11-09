/**
 * F010 (owner's UI audit 11-09): the Shop Declutter grid drew nothing until its read came back, then popped in and
 * pushed the page down. While it waits it now draws a skeleton with the strip's own section padding, heading row and
 * card grid, so the real grid lands in the same space.
 *
 * @mutate src/components/landing/FreshDeclutterSection.tsx |         {state.kind === "waiting" && <FreshDeclutterSkeleton />} |
 * @mutate src/components/landing/FreshDeclutterSection.tsx | <ul className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4 lg:gap-x-5 lg:gap-y-8"> | <ul className="grid grid-cols-2 gap-3">
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FRESH_DECLUTTER_LIMIT, FreshDeclutterSection, forgetRecentFreshItems } from "./FreshDeclutterSection";
import { blankComments } from "@/test/helpers/blankNonCode";

const src = (f: string) => blankComments(readFileSync(join(process.cwd(), "src/components/landing", f), "utf8"));
const classOf = (code: string, re: RegExp) => re.exec(code)?.[1] ?? null;

afterEach(() => {
  cleanup();
  forgetRecentFreshItems();
});

describe("the Shop Declutter grid holds its place while it loads (F010)", () => {
  it("draws a skeleton of FRESH_DECLUTTER_LIMIT cards before the read answers", () => {
    render(<FreshDeclutterSection />);
    const sk = screen.getByTestId("landing-fresh-declutter-skeleton");
    expect(sk.getAttribute("aria-hidden")).toBe("true");
    expect(sk.querySelectorAll("li").length).toBe(FRESH_DECLUTTER_LIMIT);
    expect(FRESH_DECLUTTER_LIMIT).toBeGreaterThan(3);
  });

  it("the skeleton's section, heading and grid are the strip's own (same classes)", () => {
    const sec = src("FreshDeclutterSection.tsx");
    const strip = src("FreshDeclutterStrip.tsx");
    const section = /className="(px-5 sm:px-8 lg:px-12 pt-8 lg:pt-12 pb-12 lg:pb-20)"/;
    const grid = /<ul className="(grid [^"]+)"/;
    const photo = /aspect-\[4\/5\]/;
    for (const re of [section, grid]) {
      const want = classOf(strip, re);
      expect(want, String(re)).not.toBeNull();
      expect(classOf(sec, re), String(re)).toBe(want);
    }
    expect(sec).toMatch(photo);
    expect(strip).toMatch(photo);
  });
});
