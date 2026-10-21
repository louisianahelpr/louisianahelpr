/**
 * The section "+" in the top bar is NOT the loudest thing in it (owner,
 * 2026-10-19: it was a big filled olive circle). It is the same control as the
 * bell beside it, the same size and weight, in every section: a ghost icon
 * Button wearing the bar's one icon class, with no fill.
 *
 * @mutate src/components/sections/AppTopBar.tsx |           data-testid="section-add"\n          onClick={isPost ? gate.gate("post", go) : go}\n          {...(isPost ? gate.gatedProps("post") : {})}\n          className={TOP_BAR_ICON_CLASS}\n |           data-testid="section-add"\n          onClick={isPost ? gate.gate("post", go) : go}\n          {...(isPost ? gate.gatedProps("post") : {})}\n          className="btn-press w-10 h-10 rounded-full btn-grad-primary flex items-center justify-center"\n
 * @mutate src/components/sections/AppTopBar.tsx |           variant="ghost"\n          size="icon"\n          aria-label={add.label} |           variant="default"\n          size="icon"\n          aria-label={add.label}
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
  it("the bell wears the same icon size (its class starts with the +'s)", () => {
    const icon = bar.match(/const TOP_BAR_ICON_CLASS = "([^"]+)";/)?.[1] ?? "";
    expect(icon).toMatch(/h-11 w-11/);
    const bell = bar.match(/<NotificationPanel triggerClassName="([^"]+)"/)?.[1] ?? "";
    expect(bell.startsWith(icon), `bell "${bell}" vs + "${icon}"`).toBe(true);
  });
  it("no filled primary surface anywhere in the bar", () => {
    expect(bar).not.toMatch(/btn-grad-primary/);
  });
});
