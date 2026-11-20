/**
 * Home = board 7 (owner-approved 2026-10-20), restyle only:
 *   - Next up names the to-do's section (icon + name) top right, and its row is
 *     one to-do keeps its ONE action under it; several are a short list (owner polish 11-20, no carousel dots);
 *   - Coming up sits ABOVE the section tiles, each row a section icon in a
 *     tinted circle + "<your side> · <when>" ("You hired" / "You're working");
 *   - no price on a Coming up job row (rust is money only; the board shows none).
 *
 * @mutate src/pages/home/homeDashboard/comingUp.ts |   posted: "You hired", |   posted: "Posted",
 * @mutate src/pages/home/HomeDashboard.tsx | meta={<span data-coming-up-role={c.role}>{[t(`home.role.${c.role}`), whenLine(c)].filter(Boolean).join(" · ")}</span>} | meta={whenLine(c)}
 * @mutate src/pages/home/HomeDashboard.tsx |                       onClick={() => navigate(c.to)}\n                      last={last} |                       onClick={() => navigate(c.to)}\n                      right={<span className="text-ds-15 font-bold shrink-0">$1</span>}\n                      last={last}
 * @mutate src/pages/home/HomeDashboard.tsx | <span data-testid="next-up-section" | <span data-testid="next-up-section" hidden
 * @mutate src/pages/home/HomeDashboard.tsx | const NEXT_UP_LIST_MAX = 3; | const NEXT_UP_LIST_MAX = 8;
 * @mutate src/pages/home/homeDashboard/homeFirstExtras.tsx | variant={i === 0 ? "primary" : "outline"} | variant="primary"
 * @mutate src/pages/home/HomeDashboard.tsx | xl:grid xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] | xl:flex
 * @mutate src/pages/home/HomeDashboard.tsx |               if (isWebDesktop) { |               if (false) {
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { COMING_UP_ROLE } from "@/pages/home/homeDashboard/comingUp";

const src = blankComments(readFileSync(resolve(__dirname, "../pages/home/HomeDashboard.tsx"), "utf8"));
// Owner polish 11-20: the Needs you short list lives in its own chunk (homeFirstExtras.tsx, /home critical-path budget).
const extrasSrc = blankComments(readFileSync(resolve(__dirname, "../pages/home/homeDashboard/homeFirstExtras.tsx"), "utf8"));

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
    const block = src.slice(src.indexOf('<GroupSection title={t("home.comingUp")}>'), src.indexOf('aria-label={t("home.yourSections")}'));
    expect(block.length).toBeGreaterThan(300);
    expect(block).toContain("data-coming-up-role={c.role}");
    expect(block).toContain("t(`home.role.${c.role}`)");
    // The phone row's caption: "<your side> · <when>".
    expect(block).toMatch(/meta=\{<span data-coming-up-role=\{c\.role\}>\{\[t\(`home\.role\.\$\{c\.role\}`\), whenLine\(c\)\]/);
    expect(block).toMatch(/leading=\{\s*<span aria-hidden data-coming-up-section=\{c\.section\} className="w-10 h-10 shrink-0 rounded-full/);
    // The row's icon is ITS section's (spec v2 §5.4: Declutter and Shops rows sit beside jobs).
    expect(block).toMatch(/const d = sectionDef\(c\.section\);\s*const Icon = d\.icon;/);
    expect(block).not.toMatch(/budget|right=\{/);
  });

  it("Next up names its section, top right", () => {
    expect(src).not.toMatch(/<span data-testid="next-up-section" hidden/);
    expect(src).toMatch(/<span data-testid="next-up-section"[^>]*>\s*<Icon/);
  });

  it("owner polish 11-20: several to-dos are a SHORT LIST (no carousel dots), one primary action, See all for the rest", () => {
    // No dots, no "1 of n": every listed to-do is a row with its own action.
    expect(src).not.toMatch(/data-next-up-dot/);
    expect(src).not.toMatch(/setShown/);
    const cap = Number(src.match(/const NEXT_UP_LIST_MAX = (\d+);/)?.[1]);
    expect(cap).toBeGreaterThan(1);
    expect(cap).toBeLessThanOrEqual(5); // short: See all lists the rest
    expect(src).toContain("const listed = todoCount > 1 ? summary.todos.slice(0, NEXT_UP_LIST_MAX) : [];");
    // Home keeps ONE primary action: the most urgent row's; the others are outline.
    expect(extrasSrc).toContain('variant={i === 0 ? "primary" : "outline"}');
    expect(src).toContain("<extras.NeedsYouList todos={listed}");
    expect(src).toContain('t("home.needsYouN", { n: todoCount })');
  });

  it("desktop is board 11: two columns from 1280, sections on the right, Coming up as a table, no Next up dots", () => {
    // Two columns: left = Next up / To do / Coming up, right = Your sections.
    const cols = src.match(/<div data-home-columns className="([^"]*)">/);
    expect(cols, "the columns wrapper").not.toBeNull();
    expect(cols![1]).toMatch(/\bxl:grid\b/);
    expect(cols![1]).toMatch(/xl:grid-cols-\[minmax\(0,3fr\)_minmax\(0,2fr\)\]/);
    const main = src.indexOf("<div data-home-main");
    const side = src.indexOf('<section data-home-side className="flex flex-col gap-2 min-w-0" aria-label={t("home.yourSections")}>');
    expect(main).toBeGreaterThan(src.indexOf("<div data-home-columns"));
    expect(side).toBeGreaterThan(src.indexOf('<GroupSection title={t("home.comingUp")}>'));
    expect(src.indexOf('data-testid="next-up"')).toBeGreaterThan(main);
    // Coming up on desktop: day · time · title · "<Section> · <your side>" columns.
    const table = src.slice(src.indexOf("if (isWebDesktop) {"), src.indexOf("data-coming-up-table-row") + 1100);
    expect(table).toContain("grid-cols-[6.5rem_4.5rem_minmax(0,1fr)_auto]");
    expect(table).toMatch(/\{sectionLabel\(d\)\} · \{t\(`home\.role\.\$\{c\.role\}`\)\}/);
    expect(table).not.toMatch(/budget|price|money/);
    // No Next up dots anywhere (owner polish 11-20: the to-dos are a short list).
    expect(src).not.toMatch(/data-next-up-dot/);
  });
});
