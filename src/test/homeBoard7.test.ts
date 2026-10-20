/**
 * Home = board 7 (owner-approved 2026-10-20), restyle only:
 *   - Next up names the to-do's section (icon + name) top right, and its row is
 *     dots (+ See all) left, the ONE action right;
 *   - Coming up sits ABOVE the section tiles, each row a section icon in a
 *     tinted circle + "<your side> · <when>" ("You hired" / "You're working");
 *   - no price on a Coming up job row (rust is money only; the board shows none).
 *
 * @mutate src/pages/home/homeDashboard/comingUp.ts |   posted: "You hired", |   posted: "Posted",
 * @mutate src/pages/home/HomeDashboard.tsx | meta={<span data-coming-up-role={c.role}>{[COMING_UP_ROLE[c.role], whenLine(c)].filter(Boolean).join(" · ")}</span>} | meta={whenLine(c)}
 * @mutate src/pages/home/HomeDashboard.tsx |                       onClick={() => navigate(c.to)}\n                      last={last} |                       onClick={() => navigate(c.to)}\n                      right={<span className="text-ds-15 font-bold shrink-0">$1</span>}\n                      last={last}
 * @mutate src/pages/home/HomeDashboard.tsx | <span data-testid="next-up-section" | <span data-testid="next-up-section" hidden
 * @mutate src/pages/home/HomeDashboard.tsx | <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1"> | <div className="flex items-center gap-x-3 gap-y-1 mt-1">
 * @mutate src/pages/home/HomeDashboard.tsx | const NEXT_UP_MAX_DOTS = 5; | const NEXT_UP_MAX_DOTS = 8;
 * @mutate src/pages/home/HomeDashboard.tsx | xl:grid xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] | xl:flex
 * @mutate src/pages/home/HomeDashboard.tsx |               if (isWebDesktop) { |               if (false) {
 * @mutate src/pages/home/HomeDashboard.tsx | <div className="flex items-center -ml-2 lg:hidden" role="group" | <div className="flex items-center -ml-2" role="group"
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { COMING_UP_ROLE } from "@/pages/home/homeDashboard/comingUp";

const src = blankComments(readFileSync(resolve(__dirname, "../pages/home/HomeDashboard.tsx"), "utf8"));

describe("Home matches board 7", () => {
  it("is not vacuous", () => {
    expect(src.length).toBeGreaterThan(4000);
    expect(src).toContain('data-testid="next-up"');
  });

  it("each Coming up row says which side you are on, with the section icon, and no price", () => {
    expect(COMING_UP_ROLE).toEqual({
      posted: "You hired",
      working: "You're working",
      buying: "You're buying",
      selling: "You're selling",
      ordered: "You ordered",
      shop: "Your shop",
    });
    const block = src.slice(src.indexOf('<GroupSection title="Coming up">'), src.indexOf('aria-label="Your sections"'));
    expect(block.length).toBeGreaterThan(300);
    expect(block).toContain("data-coming-up-role={c.role}");
    expect(block).toContain("COMING_UP_ROLE[c.role]");
    // The phone row's caption: "<your side> · <when>".
    expect(block).toMatch(/meta=\{<span data-coming-up-role=\{c\.role\}>\{\[COMING_UP_ROLE\[c\.role\], whenLine\(c\)\]/);
    expect(block).toMatch(/leading=\{\s*<span aria-hidden data-coming-up-section=\{c\.section\} className="w-10 h-10 shrink-0 rounded-full/);
    // The row's icon is ITS section's (spec v2 §5.4: Declutter and Shops rows sit beside jobs).
    expect(block).toMatch(/const d = sectionDef\(c\.section\);\s*const Icon = d\.icon;/);
    expect(block).not.toMatch(/budget|right=\{/);
  });

  it("Next up names its section, top right", () => {
    expect(src).not.toMatch(/<span data-testid="next-up-section" hidden/);
    expect(src).toMatch(/<span data-testid="next-up-section"[^>]*>\s*<Icon/);
  });

  it("the dots + See all + action row wraps, so the action never covers a dot (axe target-size at 320/375, TRAIN23)", () => {
    const m = src.match(/<div className="([^"]*)">\s*\{todoCount > 1 && \(\s*<div className="flex items-center -ml-2[^"]*" role="group" aria-label="Your to-dos">/);
    expect(m, "the Next up dots row").not.toBeNull();
    expect(m![1]).toMatch(/\bflex-wrap\b/);
    // See all + the action are ONE group that grows to the row's width when it wraps.
    expect(src).toMatch(/<div data-next-up-actions className="[^"]*\bgrow\b[^"]*"/);
    // Five 44px dot targets (the index.css floor) are 212px after the -ml-2; the 320 card gives 248.
    const cap = Number(src.match(/const NEXT_UP_MAX_DOTS = (\d+);/)?.[1]);
    expect(cap).toBeGreaterThan(1);
    expect(cap * 44 - 8).toBeLessThanOrEqual(248);
    expect(src).toContain("summary.todos.slice(0, NEXT_UP_MAX_DOTS)");
  });

  it("desktop is board 11: two columns from 1280, sections on the right, Coming up as a table, no Next up dots", () => {
    // Two columns: left = Next up / To do / Coming up, right = Your sections.
    const cols = src.match(/<div data-home-columns className="([^"]*)">/);
    expect(cols, "the columns wrapper").not.toBeNull();
    expect(cols![1]).toMatch(/\bxl:grid\b/);
    expect(cols![1]).toMatch(/xl:grid-cols-\[minmax\(0,3fr\)_minmax\(0,2fr\)\]/);
    const main = src.indexOf("<div data-home-main");
    const side = src.indexOf('<section data-home-side className="flex flex-col gap-2 min-w-0" aria-label="Your sections">');
    expect(main).toBeGreaterThan(src.indexOf("<div data-home-columns"));
    expect(side).toBeGreaterThan(src.indexOf('<GroupSection title="Coming up">'));
    expect(src.indexOf('data-testid="next-up"')).toBeGreaterThan(main);
    // Coming up on desktop: day · time · title · "<Section> · <your side>" columns.
    const table = src.slice(src.indexOf("if (isWebDesktop) {"), src.indexOf("data-coming-up-table-row") + 1100);
    expect(table).toContain("grid-cols-[6.5rem_4.5rem_minmax(0,1fr)_auto]");
    expect(table).toMatch(/\{d\.label\} · \{COMING_UP_ROLE\[c\.role\]\}/);
    expect(table).not.toMatch(/budget|price|money/);
    // Next up on desktop: the action, then See all; no dots (board 11).
    expect(src).toMatch(/<div className="flex items-center -ml-2 lg:hidden" role="group" aria-label="Your to-dos">/);
    expect(src).toMatch(/data-next-up-actions className="[^"]*lg:flex-row-reverse lg:justify-end/);
  });
});
