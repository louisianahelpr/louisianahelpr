/**
 * THE LANDING'S FIRST SCREEN (owner, 2026-10-27, landing at 1440): the strip under the search showed
 * 2 of its 3 items, so its right third stood empty; and "the size of Louisiana's local partner is
 * fine. it just needs to be centered on the page with the stuff below smaller."
 *
 * Root cause of the empty third: LandingProof dropped its "Verified ID" item while the ID check is
 * off (switch identity_check, owner 2026-10-23) and nothing took its place, so the row held two items.
 *
 * The CLASS, for both answers of the ID switch: at lg the row's column count equals the number of
 * items it shows there, and that number is 3 (the finished job + two facts). Any item that goes
 * missing again, or a column count that is not the item count, fails here.
 *
 * The first screen: the section fills the screen (100svh) and the H1, subhead and search are one
 * block centred in it above the proof row; the H1 keeps its sizes and stays at least 3x the subhead;
 * the subhead is at most 20px, the search field at most 52px tall, and the proof row's text at most
 * 16px with a photo at most 72px. Before/after screenshots and measurements at 375, 768 and 1440:
 * ~/.lh-shots/landing-tighten-1027/.
 *
 * @mutate src/components/landing/LandingProof.tsx |   return [idOn ? ID_ITEM : PICK_ITEM, PRICE_ITEM]; |   return idOn ? [ID_ITEM, PRICE_ITEM] : [PRICE_ITEM];
 * @mutate src/components/landing/LandingProof.tsx | grid gap-3 lg:grid-cols-3 lg:gap-10 | grid gap-3 lg:grid-cols-2 lg:gap-10
 * @mutate src/components/landing/HeroSection.tsx | text-ds-16 sm:text-ds-17 lg:text-ds-20 leading-relaxed | text-ds-16 sm:text-ds-18 lg:text-ds-22 xl:text-ds-24 leading-relaxed
 * @mutate src/components/landing/HeroSection.tsx | pl-4 lg:pl-5 pr-1 h-12 lg:h-[52px] | pl-4 lg:pl-5 pr-1 h-12 lg:h-14
 * @mutate src/components/landing/HeroSection.tsx | <div data-testid="landing-hero-block" className="flex flex-1 flex-col justify-center"> | <div data-testid="landing-hero-block" className="flex flex-col">
 * @mutate src/components/landing/HeroSection.tsx | xl:text-[7.75rem] | xl:text-[6rem]
 * @mutate src/components/landing/LandingProof.tsx | text-ds-15 lg:text-ds-16 font-semibold" style={{ color: "var(--lp-ink)" }}>\n            {it.title} | text-ds-15 lg:text-ds-20 font-semibold" style={{ color: "var(--lp-ink)" }}>\n            {it.title}
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { blankComments } from "./helpers/blankNonCode";
import { LandingProof, proofItems } from "@/components/landing/LandingProof";
import { setIdentityCheckOn } from "@/lib/identityCheckSwitch";

const read = (rel: string) => blankComments(readFileSync(join(process.cwd(), rel), "utf8"));

afterEach(() => {
  cleanup();
  act(() => setIdentityCheckOn(false));
});

/** The items the row shows at lg: every <li> not hidden from lg up (`lg:hidden`), plus those only shown there. */
function lgItems(row: HTMLElement): HTMLElement[] {
  return [...row.querySelectorAll<HTMLElement>(":scope > li")].filter((li) => !li.className.split(/\s+/).includes("lg:hidden"));
}

describe("the landing proof row has as many columns as items, and they are three", () => {
  for (const idOn of [false, true]) {
    it(`ID check ${idOn ? "on" : "off"}`, () => {
      act(() => setIdentityCheckOn(idOn));
      render(<LandingProof />);
      const row = screen.getByTestId("landing-proof");
      const items = lgItems(row);
      const cols = Number(/\blg:grid-cols-(\d+)\b/.exec(row.className)?.[1]);
      expect(items.length).toBeGreaterThan(2);
      expect(items.length).toBe(3);
      expect(cols).toBe(items.length);
      // Each item says something: no empty cell.
      for (const li of items) expect(li.textContent?.trim().length).toBeGreaterThan(10);
      expect(proofItems(idOn)).toHaveLength(2);
    });
  }

  it("with the ID check off, no line claims an ID check", () => {
    act(() => setIdentityCheckOn(false));
    render(<LandingProof />);
    expect(screen.getByTestId("landing-proof").textContent).not.toMatch(/Photo ID|Verified ID/);
  });
});

/** The px of a Tailwind text size token in the class list for one breakpoint prefix ("" = base). */
function sizeAt(classes: string, prefix: string): number | null {
  const esc = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`(?:^|\\s)${esc}text-(?:ds-(\\d+)|\\[(\\d+(?:\\.\\d+)?)rem\\])(?=\\s|$)`).exec(classes);
  if (!m) return null;
  return m[1] ? Number(m[1]) : Number(m[2]) * 16;
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

  it("the section fills the first screen and the block is centred in it, above the proof row", () => {
    expect(section.split(/\s+/)).toEqual(expect.arrayContaining(["flex", "flex-col", "min-h-[100svh]"]));
    expect(block.split(/\s+/)).toEqual(expect.arrayContaining(["flex", "flex-1", "flex-col", "justify-center"]));
    // The H1, subhead and search are inside the block; the proof row follows it.
    const at = (t: string) => hero.indexOf(t);
    expect(at('data-testid="landing-hero-block"')).toBeLessThan(at("<h1"));
    expect(at("<h1")).toBeLessThan(at('role="search"'));
    expect(at('role="search"')).toBeLessThan(at("<LandingProof />"));
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
    const sizes = [...proof.matchAll(/(?:^|\s)(?:lg:)?text-ds-(\d+)(?=\s|")/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(5);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(16);
    const photo = [...proof.matchAll(/(?:^|\s)(?:lg:)?w-(?:(\d+)|\[(\d+)px\])(?=\s|")/g)].map((m) => (m[1] ? Number(m[1]) * 4 : Number(m[2])));
    expect(photo.length).toBeGreaterThan(0);
    expect(Math.max(...photo)).toBeLessThanOrEqual(72);
  });
});
