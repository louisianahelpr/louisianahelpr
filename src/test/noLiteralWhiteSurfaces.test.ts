/**
 * RATCHET: inline `background` / `backgroundColor` literals of pure white.
 *
 * Q179 (2026-09-23 visual walk, prod, dark theme): the Reviews sort chip was
 * `hsla(0, 0%, 100%, 0.65)` — a light-mode glass. In dark it painted a pale
 * grey pill with light text on it that read as disabled. The fix is the
 * surface's own token (`hsl(var(--card) / a)`, pure white in light, the dark
 * card in dark), the same rule CLAUDE.md states for reduced transparency.
 *
 * Some literal whites are legitimate — a scrim over a PHOTO (the lightbox) is
 * the same in both themes — so this is an EXACT per-file baseline, not a ban:
 * a new site fails, and fixing one fails too until its count here is lowered
 * (two-way). Q277 (2026-09-26) judged every site in dark: the twelve that
 * painted a pale grey block moved to hsl(var(--card) / a) (the Wrapped
 * skeleton to --parchment, matching its loaded tile); the two files left below
 * are right in both themes, for the reason beside each.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

// @mutate src/components/profile/ReviewsTab.tsx | background: "hsl(var(--card) / 0.65)", | background: "hsla(0, 0%, 100%, 0.65)",
// @mutate src/components/profile/TwoFactorCard.tsx | background: "hsl(var(--card) / 0.55)", | background: "hsla(0, 0%, 100%, 0.55)",

const ROOT = resolve(__dirname, "..", "..");
const FILES = execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith("src/test/"));

const LITERAL_WHITE_BG =
  /background(Color)?:\s*["'`](rgba?\(\s*255,\s*255,\s*255|hsla?\(\s*0,?\s*0%,?\s*100%|#fff\b|#ffffff\b|white\b)/gi;

// @two-way src/test/noLiteralWhiteSurfaces.test.ts:stale literal-white baseline entry
const BASELINE: Record<string, number> = {
  // Judged in dark 2026-09-26 (Q277): the footer's 8% white is a faint lift over
  // the dark page, not a pale block (screenshot of / at 375, dark and light).
  "src/components/Footer.tsx": 1,
  // Judged 2026-09-26 (Q277): all five sit on the lightbox's own scrim,
  // hsla(38, 18%, 12%, 0.55), which is dark in BOTH themes, so a white wash is
  // right in both.
  "src/components/dashboard/PhotoLightbox.tsx": 5,
};

describe("literal-white inline surfaces are ratcheted (Q179)", () => {
  it("scans the shipped source", () => {
    expect(FILES.length).toBeGreaterThan(500);
  });

  it("matches the exact per-file baseline", () => {
    const found: Record<string, number> = {};
    for (const f of FILES) {
      const n = (blankComments(readFileSync(resolve(ROOT, f), "utf8")).match(LITERAL_WHITE_BG) ?? []).length;
      if (n) found[f] = n;
    }
    for (const [f, n] of Object.entries(BASELINE)) {
      expect(found[f] ?? 0, `stale literal-white baseline entry ${f} — lower it to ${found[f] ?? 0}`).toBe(n);
    }
    expect(found).toEqual(BASELINE);
  });
});
