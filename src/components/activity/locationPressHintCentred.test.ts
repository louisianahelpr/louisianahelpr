/**
 * VN-26 (owner, 2026-09-14): the Posts "Tap a card to open it…" tip strip
 * "needs to be centered better". Pin, sentence and X must share one vertical
 * centre: `items-center` on the strip, no `mt-0.5` nudge on the pin, and no
 * all-sides `-m-2.5` on the X. Source-level (jsdom has no layout); fails on the
 * original `items-start` / `mt-0.5` / `-m-2.5` strings.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "PostedJobsTab.tsx"), "utf8");
const start = src.indexOf("function LocationPressHint");
// Comments are stripped: the component's own comment names the old classes it
// replaced, which is history, not markup.
const hint = src
  .slice(start, src.indexOf("\n}\n", start))
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/^\s*\/\/.*$/gm, "");

describe("LocationPressHint centring (VN-26)", () => {
  it("centres icon, text and dismiss on one line", () => {
    expect(start, "LocationPressHint not found").toBeGreaterThan(-1);
    expect(hint).toMatch(/className="flex items-center gap-2 rounded-ds-md/);
    expect(hint, "strip is still items-start").not.toMatch(/items-start/);
    expect(hint, "pin still nudged with mt-0.5").not.toMatch(/\bmt-0\.5\b/);
    expect(hint, "X still uses all-sides -m-2.5").not.toMatch(/\s-m-2\.5\s/);
  });
});
