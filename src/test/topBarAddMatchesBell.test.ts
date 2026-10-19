/**
 * The section "+" in the top bar is NOT the loudest thing in it (owner,
 * 2026-10-19: it was a big filled olive circle). It is the same control as the
 * bell beside it, the same size and weight, in every section: a ghost icon
 * Button wearing the bar's one icon class, with no fill.
 *
 * @mutate src/components/sections/AppTopBar.tsx |             className={TOP_BAR_ICON_CLASS}\n | className="btn-press w-10 h-10 rounded-full btn-grad-primary flex items-center justify-center"\n
 * @mutate src/components/sections/AppTopBar.tsx |             variant="ghost" | variant="default"
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const bar = blankComments(readFileSync(resolve(__dirname, "../components/sections/AppTopBar.tsx"), "utf8"));

describe("the section + matches the bell", () => {
  const add = bar.match(/<Button[^>]*data-testid="section-add"[^>]*>/s)?.[0] ?? "";
  it("the + is found (else this checks nothing)", () => expect(add.length).toBeGreaterThan(20));
  it("is a ghost icon Button wearing the bar's icon class", () => {
    expect(add).toContain('variant="ghost"');
    expect(add).toContain('size="icon"');
    expect(add).toContain("className={TOP_BAR_ICON_CLASS}");
  });
  it("the bell wears the same icon class", () => {
    expect(bar).toMatch(/<NotificationPanel triggerClassName=\{`\$\{TOP_BAR_ICON_CLASS\}/);
  });
  it("no filled primary surface anywhere in the bar", () => {
    expect(bar).not.toMatch(/btn-grad-primary/);
  });
});
