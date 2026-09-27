/**
 * RATCHET: bottom-dock clearance typed out per screen (Q265).
 *
 * The dock's clearance is a shared number: `--bottom-nav-h` (96px, and 0 under
 * `html.no-bottom-nav`, which MobileNav sets when it renders no dock) feeds the
 * `safe-nav` spacing token (`pb-safe-nav`, tailwind.config.ts). Every site
 * below instead types `var(--safe-area-bottom) + 96px` (or `+ 6rem`) itself,
 * so it keeps reserving 96px on a route with no dock, and each one is a place
 * the number can drift from the others.
 *
 * Counted 2026-09-26: 10 sites in 9 files (plus 4 Tailwind `_+_96px` sites the
 * first regex could not see). Moved onto `var(--bottom-nav-h, 96px)` /
 * `pb-safe-nav` on 2026-09-27 (Q265); the one left is the dock's own curtain.
 * The EXACT per-file list is held here: a new literal fails, and a stale
 * entry fails (two-way).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

// @mutate src/components/ui/sonner.tsx | bottom: "calc(var(--safe-area-bottom, 0px) + var(--bottom-nav-h, 96px))", | bottom: "calc(var(--safe-area-bottom, 0px) + 96px)",
// @mutate src/pages/jobs/JobDetail.tsx | pt-20 pb-safe-nav | pt-20 pb-[calc(var(--safe-area-bottom,0px)_+_96px_+_1rem)]
// @mutate src/components/MobileNav.tsx | height: "calc(var(--safe-area-bottom, 0px) + 96px + 24px)", | height: "calc(var(--safe-area-bottom, 0px) + var(--bottom-nav-h, 96px) + 24px)",
// @mutate src/components/ui/PageScaffold.tsx | import type { CSSProperties, ReactNode } from "react"; | const __q265 = "calc(var(--safe-area-bottom, 0px) + 96px)"; import type { CSSProperties, ReactNode } from "react";

const ROOT = resolve(__dirname, "..", "..");
const FILES = execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(tsx?|css)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith("src/test/"));

// Both spellings: an inline style (`, 0px) + 96px`) and a Tailwind arbitrary
// value (`,0px)_+_96px`), which the first regex missed at four sites (Q265).
const DOCK_LITERAL = /var\(--safe-area-bottom,\s*0px\)(?:\s*\+\s*|_\+_)(?:96px|6rem)/g;

// @two-way src/test/dockClearanceLiterals.test.ts:stale dock-clearance baseline entry
const BASELINE: Record<string, number> = {
  // The dock's own frosted curtain, rendered only while the dock itself is: it
  // describes the dock's height, not clearance a page reserves for it.
  "src/components/MobileNav.tsx": 1,
};

describe("dock clearance is not typed out per screen (Q265)", () => {
  it("scans the shipped source", () => {
    expect(FILES.length).toBeGreaterThan(500);
  });

  it("matches the exact per-file baseline", () => {
    const found: Record<string, number> = {};
    for (const f of FILES) {
      const src = readFileSync(resolve(ROOT, f), "utf8");
      const n = ((f.endsWith(".css") ? src : blankComments(src)).match(DOCK_LITERAL) ?? []).length;
      if (n) found[f] = n;
    }
    for (const [f, n] of Object.entries(BASELINE)) {
      expect(found[f] ?? 0, `stale dock-clearance baseline entry ${f} — lower it to ${found[f] ?? 0}`).toBe(n);
    }
    expect(found, "a new hand-typed dock clearance: use pb-safe-nav / var(--bottom-nav-h) instead").toEqual(BASELINE);
  });
});
