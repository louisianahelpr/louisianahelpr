/**
 * F017 (owner UI audit 11-09, /browse at 1440: "Header here is full-width (logo at the far left edge) while the landing
 * page header is held to the content width, so the logo and links jump position between pages"): every public page's
 * bar, title and body sit in ONE container, the landing's 78rem (src/lib/publicContainer.ts). The /browse HTML shell and
 * its React skeleton spell the same container, so the first paint and the app agree (no shift at the handoff).
 *
 * @mutate src/components/Navbar.tsx |           PUBLIC_CONTAINER, |           landing && PUBLIC_CONTAINER,
 * @mutate src/components/marketing/PublicHeaderPage.tsx |       <div data-public-container="" className={PUBLIC_CONTAINER}> |       <div data-public-container="">
 * @mutate src/lib/browseShellCards.mjs | export const SHELL_PUBLIC_CONTAINER = "max-w-[78rem] mx-auto"; | export const SHELL_PUBLIC_CONTAINER = "w-full";
 * @mutate src/components/GuestBrowseSkeleton.tsx |     <div className={PUBLIC_CONTAINER}>\n    <PageHeader | <div>\n    <PageHeader
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PUBLIC_CONTAINER } from "@/lib/publicContainer";
import { SHELL_PUBLIC_CONTAINER, browseShellHtml } from "@/lib/browseShellCards.mjs";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");
const code = (p: string) => blankComments(readFileSync(join(ROOT, p), "utf8"));

describe("F017: one public-page container", () => {
  it("is the landing's 78rem measure, and the edge shell spells the same classes", () => {
    expect(PUBLIC_CONTAINER).toBe("max-w-[78rem] mx-auto");
    expect(SHELL_PUBLIC_CONTAINER).toBe(PUBLIC_CONTAINER);
  });

  it("the bar wears it on every page, not only the landing", () => {
    const nav = code("src/components/Navbar.tsx");
    expect(nav).toMatch(/\n\s+PUBLIC_CONTAINER,\n/);
    expect(nav).not.toMatch(/landing && (PUBLIC_CONTAINER|"max-w-\[78rem\])/);
  });

  it("PublicHeaderPage holds the title and the body to it; the /browse skeleton too", () => {
    expect(code("src/components/marketing/PublicHeaderPage.tsx")).toContain('<div data-public-container="" className={PUBLIC_CONTAINER}>');
    const skel = code("src/components/GuestBrowseSkeleton.tsx");
    expect(skel).toContain("<div className={PUBLIC_CONTAINER}>");
    expect(skel).toContain("h-[var(--public-nav-h)] px-5 sm:px-8 lg:px-12 ${PUBLIC_CONTAINER}");
  });

  it("the /browse HTML shell's bar and body are in it", () => {
    const html = browseShellHtml([], Date.parse("2026-11-09T18:00:00Z"));
    expect(html.length).toBeGreaterThan(1000);
    expect(html.indexOf(`h-[var(--public-nav-h)] px-5 sm:px-8 lg:px-12 ${PUBLIC_CONTAINER}"`)).toBeGreaterThan(0);
    expect(html.indexOf(`<div class="flex-1"><div class="${PUBLIC_CONTAINER}">`)).toBeGreaterThan(0);
  });
});
