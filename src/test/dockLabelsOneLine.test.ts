/**
 * The bottom nav shows a small one-word label under each icon (owner,
 * 2026-10-19, Facebook / Airbnb style), on ONE line and never truncated, at
 * 320 with six tabs. The pixel half (no two labels touch, none leaves the
 * dock, at 320 and 375) is e2e/prod-audit/dock-labels.spec.ts.
 *
 * @mutate src/components/MobileNav.tsx |           {label}\n        </span> |           {""}\n        </span>
 * @mutate src/components/MobileNav.tsx | relative z-10 block whitespace-nowrap text-ds-10 | relative z-10 block truncate text-ds-10
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const nav = blankComments(readFileSync(resolve(__dirname, "../components/MobileNav.tsx"), "utf8"));
const span = nav.match(/<span\s+data-dock-label[\s\S]*?<\/span>/)?.[0] ?? "";

describe("dock labels", () => {
  it("each tab renders its label in a data-dock-label span", () => {
    expect(span.length, "the label span was not found").toBeGreaterThan(20);
    expect(span).toMatch(/\{label\}/);
  });
  it("one line, never cut: nowrap, no truncate / ellipsis / overflow clip, 10-11px", () => {
    expect(span).toContain("whitespace-nowrap");
    expect(span).not.toMatch(/truncate|text-ellipsis|overflow-hidden|line-clamp/);
    expect(span).toMatch(/text-ds-10/);
    expect(span).toMatch(/min-\[360px\]:text-ds-11/);
  });
});
