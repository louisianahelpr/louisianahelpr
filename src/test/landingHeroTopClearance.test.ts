// @mutate src/components/landing/HeroSection.tsx | px-5 sm:px-8 lg:px-12 pt-32 sm:pt-28 | px-5 sm:px-8 lg:px-12 pt-24 sm:pt-28
/**
 * The landing title sits clear of the top bar at phone width (owner,
 * 2026-10-26, iPhone screenshot: "This needs more space it's crammed ... the
 * title is too far up"). Measured at 375 on the built bundle: the top bar's
 * "Join free" button ends at 54px; with pt-24 the H1 began at 96px (a 42px
 * gap), with pt-32 at 128px (74px). The guard reads the hero <section>'s
 * unprefixed (phone) top padding and requires at least 64px of clear space
 * under that 54px bar.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const TOP_BAR_BOTTOM_PX = 54; // measured, 375 and 320, 2026-10-26
const MIN_CLEAR_PX = 64;

function phoneTopPaddingPx(className: string): number | null {
  for (const tok of className.split(/\s+/)) {
    const m = /^pt-(\d+(?:\.\d+)?)$/.exec(tok) ?? /^pt-\[(\d+)px\]$/.exec(tok);
    if (!m) continue;
    return tok.includes("px]") ? Number(m[1]) : Number(m[1]) * 4;
  }
  return null;
}

describe("landing hero clears the top bar at phone width", () => {
  const src = blankComments(readFileSync("src/components/landing/HeroSection.tsx", "utf8"));
  const sections = [...src.matchAll(/<section\s+className="([^"]+)"/g)].map((m) => m[1]);

  it("finds the hero section", () => {
    expect(sections.length).toBeGreaterThan(0);
  });

  it("leaves at least 64px between the top bar and the title", () => {
    const pt = phoneTopPaddingPx(sections[0]);
    expect(pt, `no unprefixed pt-* on the hero section: ${sections[0]}`).not.toBeNull();
    expect(pt! - TOP_BAR_BOTTOM_PX).toBeGreaterThanOrEqual(MIN_CLEAR_PX);
  });
});
