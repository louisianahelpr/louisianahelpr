/**
 * THE LANDING'S FIRST SCREEN (owner, 2026-10-27, landing at 1440): the strip under the search showed
 * 2 of its 3 items, so its right third stood empty; and "the size of Louisiana's local partner is
 * fine. it just needs to be centered on the page with the stuff below smaller."
 *
 * Root cause of the empty third: LandingProof dropped its "Verified ID" item while the ID check is
 * off (switch identity_check, owner 2026-10-23) and nothing took its place, so the row held two items.
 *
 * Owner 11-09 (10:31 PM): the proof row is no longer a row: the finished job is the Jobs grid's first card and the two
 * facts are that section's line (src/test/landingJustFinishedInJobs1109.test.tsx holds it), so the three-column rule
 * went with it. What stays here is the first screen and the small sizes.
 *
 * The first screen: the section fills the screen (100svh; on a phone 120px less, owner 11-08, so the Jobs | Declutter
 * switch peeks in) and the H1, subhead and search are one
 * block centred in it (the proof row moved below the fold, owner 2026-11-02: landingProofBelowTheFold); the H1 keeps its sizes and stays at least 3x the subhead;
 * the subhead is at most 20px, the search field at most 52px tall, and the proof row's text at most
 * 16px with a photo at most 72px. Before/after screenshots and measurements at 375, 768 and 1440:
 * ~/.lh-shots/landing-tighten-1027/.
 *
 * @mutate src/components/landing/HeroSection.tsx | text-[16px] sm:text-[17px] lg:text-[20px] leading-relaxed | text-[16px] sm:text-[18px] lg:text-[22px] xl:text-[24px] leading-relaxed
 * @mutate src/components/landing/HeroSection.tsx | pl-4 lg:pl-5 pr-1 h-12 lg:h-[52px] | pl-4 lg:pl-5 pr-1 h-12 lg:h-14
 * @mutate src/components/landing/HeroSection.tsx | <div data-testid="landing-hero-block" className="flex flex-1 flex-col justify-center"> | <div data-testid="landing-hero-block" className="flex flex-col">
 * @mutate src/components/landing/HeroSection.tsx | xl:text-[7.75rem] | xl:text-[6rem]
 * @mutate src/components/landing/HeroSection.tsx | min-h-[calc(100svh-7.5rem)] sm:min-h-[100svh] | min-h-[100svh]
 * @mutate src/components/landing/LandingProof.tsx | <span className="text-ds-15 lg:text-ds-16 font-semibold" style={{ color: "var(--lp-ink)" }}> | <span className="text-ds-15 lg:text-ds-20 font-semibold" style={{ color: "var(--lp-ink)" }}>
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const read = (rel: string) => blankComments(readFileSync(join(process.cwd(), rel), "utf8"));

/** The px of a Tailwind text size token in the class list for one breakpoint prefix ("" = base). */
function sizeAt(classes: string, prefix: string): number | null {
  const esc = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`(?:^|\\s)${esc}text-(?:ds-(\\d+)|\\[(\\d+(?:\\.\\d+)?)rem\\]|\\[(\\d+)px\\])(?=\\s|$)`).exec(classes);
  if (!m) return null;
  // The subhead is written in px (Q2027: the locked hero keeps its own sizes outside the five-size scale).
  return m[1] ? Number(m[1]) : m[3] ? Number(m[3]) : Number(m[2]) * 16;
}

describe("the hero block is centred in the first screen, the H1 stays dominant, what sits under it is small", () => {
  const hero = read("src/components/landing/HeroSection.tsx");
  const proof = read("src/components/landing/LandingProof.tsx");
  const h1 = /<h1\s+className="([^"]+)"/.exec(hero)?.[1] ?? "";
  const sub = /<p\s+className="([^"]+)"/.exec(hero)?.[1] ?? "";
  const field = /className="landing-search-field ([^"]+)"/.exec(hero)?.[1] ?? "";
  const section = /<section\s+className="([^"]+)"/.exec(hero)?.[1] ?? "";
  const block = /data-testid="landing-hero-block" className="([^"]+)"/.exec(hero)?.[1] ?? "";

  it("finds the H1, subhead, search field, section and block", () => {
    for (const c of [h1, sub, field, section, block]) expect(c.length).toBeGreaterThan(10);
  });

  it("the section fills the first screen (on a phone less a peek for the switch) and the block is centred in it", () => {
    expect(section.split(/\s+/)).toEqual(expect.arrayContaining(["flex", "flex-col", "sm:min-h-[100svh]"]));
    // Owner 11-08: on a phone the section is shorter than the screen by enough for the Jobs | Declutter switch under
    // it to show (its top padding plus most of its 48px track), and never by more than a third of a 568px phone.
    const phone = /^min-h-\[calc\(100svh-(\d+(?:\.\d+)?)rem\)\]$/.exec(section.split(/\s+/).find((t) => t.startsWith("min-h-")) ?? "");
    expect(phone, `phone min-height on the hero section: ${section}`).not.toBeNull();
    const peekPx = Number(phone![1]) * 16;
    expect(peekPx).toBeGreaterThanOrEqual(96);
    expect(peekPx).toBeLessThanOrEqual(568 / 3);
    expect(block.split(/\s+/)).toEqual(expect.arrayContaining(["flex", "flex-1", "flex-col", "justify-center"]));
    // The H1, subhead and search are inside the block (the proof row is no longer in the hero).
    const at = (t: string) => hero.indexOf(t);
    expect(at('data-testid="landing-hero-block"')).toBeLessThan(at("<h1"));
    expect(at("<h1")).toBeLessThan(at('role="search"'));
  });

  it("the H1 keeps its size (owner: 'the size is fine') and is at least 3x the subhead at every breakpoint", () => {
    expect(h1).toContain("text-[3.25rem] min-[400px]:text-[3.5rem] sm:text-[4.75rem] lg:text-[6.5rem] xl:text-[7.75rem]");
    let last = { h: 0, s: 0 };
    for (const p of ["", "sm:", "lg:", "xl:"]) {
      const h = sizeAt(h1, p) ?? last.h;
      const s = sizeAt(sub, p) ?? last.s;
      last = { h, s };
      expect(h / s, `H1 ${h}px vs subhead ${s}px at ${p || "base"}`).toBeGreaterThanOrEqual(3);
      expect(s, `subhead at ${p || "base"}`).toBeLessThanOrEqual(20);
    }
  });

  it("the search field is at most 52px tall; the proof row's photo, labels, titles and text are small", () => {
    const heights = [...field.matchAll(/(?:^|\s)(?:[a-z]+:)?h-(?:(\d+)|\[(\d+)px\])(?=\s|$)/g)].map((m) => (m[1] ? Number(m[1]) * 4 : Number(m[2])));
    expect(heights.length).toBeGreaterThan(0);
    for (const h of heights) expect(h).toBeLessThanOrEqual(52);
    const sizes = [...proof.matchAll(/(?:^|[\s"])(?:lg:)?text-ds-(\d+)(?=\s|")/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(5);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(16);
    const photo = [...proof.matchAll(/(?:^|\s)(?:lg:)?w-(?:(\d+)|\[(\d+)px\])(?=\s|")/g)].map((m) => (m[1] ? Number(m[1]) * 4 : Number(m[2])));
    expect(photo.length).toBeGreaterThan(0);
    expect(Math.max(...photo)).toBeLessThanOrEqual(72);
  });
});
