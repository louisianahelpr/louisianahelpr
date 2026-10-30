/**
 * DA-9 (Declutter audit 2026-10-30, item page at 375 WebKit): the dock slid off on scroll and, at the end of the
 * page, left its clearance as a blank band (measured on the local dev build: 56px blank, dock top 878 of 812 before;
 * dock on screen, 0px blank after). The dock now comes back at the end of a page, and the pinned title row on the
 * item page is painted once the page has scrolled.
 *
 * @mutate src/components/mobileNav/dockAtEnd.ts |   return travel > 8 && scrollTop > 0 && travel - scrollTop <= 2; |   return false;
 * @mutate src/components/mobileNav/dockAtEnd.ts |   return travel > 8 && scrollTop > 0 && travel - scrollTop <= 2; |   return scrollTop > 0 && travel - scrollTop <= 2;
 * @mutate src/components/MobileNav.tsx | const atEnd = dockRevealsAtEnd(surface.scrollHeight, surface.clientHeight, y); | const atEnd = false;
 * @mutate src/components/MobileNav.tsx | if (!atEnd && (y < 0 \|\| Math.abs(delta) < 6)) { | if (y < 0 \|\| Math.abs(delta) < 6) {
 * @mutate src/components/MobileNav.tsx | setNavHidden(!atEnd && y >= 64 && delta > 0); | setNavHidden(y >= 64 && delta > 0);
 * @mutate src/index.css | html:not(.web-desktop).page-scrolled .sticky-title-row {\n  background: hsl(var(--background)); | html:not(.web-desktop).page-scrolled .sticky-title-row {\n  background: transparent;
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";
import { dockRevealsAtEnd } from "@/components/mobileNav/dockAtEnd";

describe("the dock at the end of a page (DA-9)", () => {
  it("reveals at the end, and within 2px of it, of a surface that really scrolls", () => {
    // The measured item page: 818px of travel.
    expect(dockRevealsAtEnd(1630, 812, 818)).toBe(true);
    expect(dockRevealsAtEnd(1630, 812, 816)).toBe(true);
    // iOS overscroll past the end.
    expect(dockRevealsAtEnd(1630, 812, 840)).toBe(true);
  });

  it("does not reveal mid page, at the top, or on a surface with no real travel", () => {
    expect(dockRevealsAtEnd(1630, 812, 700)).toBe(false);
    expect(dockRevealsAtEnd(1630, 812, 815)).toBe(false);
    expect(dockRevealsAtEnd(1630, 812, 0)).toBe(false);
    expect(dockRevealsAtEnd(816, 812, 4)).toBe(false);
  });

  it("MobileNav asks it on every scroll, the jitter filter never swallows the end, and the end always reveals", () => {
    const src = blankComments(readFileSync("src/components/MobileNav.tsx", "utf8"));
    const body = src.slice(src.indexOf("const checkScroll = "), src.indexOf("checkScroll();"));
    expect(body.length).toBeGreaterThan(200);
    const ask = body.indexOf("const atEnd = dockRevealsAtEnd(surface.scrollHeight, surface.clientHeight, y);");
    const jitter = body.indexOf("if (!atEnd && (y < 0 || Math.abs(delta) < 6)) {");
    const decide = body.indexOf("setNavHidden(!atEnd && y >= 64 && delta > 0);");
    expect(ask).toBeGreaterThan(-1);
    expect(jitter).toBeGreaterThan(ask);
    expect(decide).toBeGreaterThan(jitter);
    // One decision: no other setNavHidden(true) path in the scroll handler.
    expect(body.split("setNavHidden(").length - 1).toBe(1);
  });

  it("the pinned title row is opaque once the page has scrolled, and not on the desktop website", () => {
    const css = readFileSync("src/index.css", "utf8");
    const at = css.indexOf("html:not(.web-desktop).page-scrolled .sticky-title-row {");
    expect(at).toBeGreaterThan(-1);
    const rule = css.slice(at, css.indexOf("}", at));
    expect(rule).toContain("background: hsl(var(--background));");
  });
});
