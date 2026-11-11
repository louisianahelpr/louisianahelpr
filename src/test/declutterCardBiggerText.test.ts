/**
 * F359r (whole-app audit 11-10): with Bigger text on, Declutter cards cut the condition to one letter ("L... · About
 * 1 mi away") and the title to two words. Under html.senior-mode the title gets two lines and the condition and the
 * distance stack, whole, with the " · " hidden (src/index.css); default text keeps owner pick 4's three lines.
 *
 * @mutate src/index.css | html.senior-mode [data-card-place] { flex-direction: column; } | html.senior-mode [data-card-place] { flex-direction: row; }
 * @mutate src/index.css | html.senior-mode [data-card-place] [data-card-condition] { white-space: normal; | html.senior-mode [data-card-place] [data-card-condition] { white-space: nowrap;
 * @mutate src/index.css | html.senior-mode [data-card-title] { | html.senior-mode [data-card-titles] {
 * @mutate src/components/declutter/DeclutterItemCard.tsx | <span data-card-sep="" className | <span className
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const css = blankComments(readFileSync(resolve(__dirname, "../index.css"), "utf8"));
const card = blankComments(readFileSync(resolve(__dirname, "../components/declutter/DeclutterItemCard.tsx"), "utf8"));
const rule = (sel: string) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${esc}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
};

describe("Declutter card under Bigger text (F359r)", () => {
  it("the card carries the hooks the rules select (vacuity floor)", () => {
    expect(card.length).toBeGreaterThan(2000);
    expect(card).toMatch(/<span data-card-title\b/);
    expect(card).toMatch(/<span data-card-place=""/);
    expect(card).toMatch(/<span data-card-condition=\{/);
    expect(card).toMatch(/<span data-card-sep=""[^>]*> · <\/span>/);
  });
  it("the title wraps to at most two lines", () => {
    const r = rule("html.senior-mode [data-card-title]");
    expect(r).toMatch(/white-space:\s*normal/);
    expect(r).toMatch(/-webkit-line-clamp:\s*2\b/);
  });
  it("condition and distance stack, the condition whole, the dot hidden", () => {
    expect(rule("html.senior-mode [data-card-place]")).toMatch(/flex-direction:\s*column/);
    expect(rule("html.senior-mode [data-card-place] [data-card-sep]")).toMatch(/display:\s*none/);
    const c = rule("html.senior-mode [data-card-place] [data-card-condition]");
    expect(c).toMatch(/white-space:\s*normal/);
    expect(c).toMatch(/text-overflow:\s*clip/);
  });
  it("default text is unchanged: one line each, truncated (owner pick 4)", () => {
    expect(card).toMatch(/data-card-title className="block truncate/);
    expect(card).toMatch(/data-card-condition=\{item\.condition_stars\} title=\{condition\} className="min-w-0 truncate"/);
  });
});
