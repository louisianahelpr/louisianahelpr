import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { Constants } from "@/integrations/supabase/types";
import { JOB_STATUS_COLORS, FALLBACK_STATUS_COLOR } from "@/lib/statusColors";
import { blankComments } from "./helpers/blankNonCode";
// @mutate src/lib/statusColors.ts |   disputed:           { bg: "hsl(var(--olivewood) / 0.18)", text: "hsl(var(--olivewood))" }, |   disputed:           { bg: "hsl(var(--destructive) / 0.18)", text: "hsl(var(--destructive))" },


/**
 * ONE ALARM COLOUR, ONE MEANING.
 *
 * Two owner findings, one rule.
 *
 *   A. "Working" and "Done" both rendered alarm red on the SAME card. Two dots
 *      in one row, the same colour, two different meanings — so the colour
 *      meant nothing.
 *   B. The rail rule the owner then set: ONE green for completed, yellow for
 *      current, grey for not-reached.
 *
 * A per-screen checklist cannot catch either. Both are statements about a SET
 * of elements ("no two of these may…", "these three and only these three"),
 * and a checklist reads one element at a time. So this file asserts over sets.
 *
 * It also holds the structural half: status colour comes from the tokens in
 * `src/lib/statusColors.ts`, never from a hex literal typed at a call site.
 * A hex at a call site cannot participate in a set rule at all — it is invisible
 * to the token map, invisible to dark mode, and invisible to the next audit.
 */

const ROOT = resolve(__dirname, "../..");
const repoFile = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

// Was a pair of deleting regexes. Measured 2026-09-21: that chain makes 208 of
// the 1,054 source files lose real code (brand-asset/index.ts loses 98% of its
// own), because a `/` + `*` inside a string or regex literal opens a comment
// that runs to the next `*` + `/` anywhere later in the file. This guard walks
// EVERY file under src/, so it was scanning emptied text and reporting green
// for an unknown share of them. The `[^:]` above was a partial patch for the
// same class — it spared `://` in URLs, which is the one symptom someone
// noticed.
const stripComments = (t: string) => blankComments(t);

function sourceFiles(): string[] {
  return execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f))
    .filter((f) => existsSync(resolve(ROOT, f)));
}

// ===========================================================================
// 1 — colour comes from the token map, not from hex at the call site
// ===========================================================================

describe("status colour comes from statusColors.ts", () => {
  it("no status/step colour is a hex literal at a call site", () => {
    /**
     * Hex is allowed in exactly two situations, both of which are NOT a status
     * colour: a fallback for `resolveToken()` (the native map SDKs cannot read
     * a CSS custom property, so the token is resolved at runtime with a hex
     * fallback), and the boot-loader / native chrome colours that have to exist
     * before any stylesheet does.
     */
    // @two-way src/test/alarmColourInvariant.test.ts:const staleAllowed =
    // EMPTIED 2026-09-22 by the two-way check below: all four former entries
    // (TrackingMap, JobLocationPreview, AppleMapPreview, main.tsx) had zero
    // lines the rule flags — their only hexes are resolveToken() fallbacks,
    // which the rule already skips line-by-line, or sit in a comment.
    const ALLOWED_FILES = new Set<string>([]);
    const STATUS_CONTEXT =
      /status|badge|chip|pill|step|tracker|dispute|complete|progress|cancel|revision|pending/i;
    const HEX = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-fA-F])/;

    const offenders: string[] = [];
    const allowedHits = new Map<string, number>();
    const files = sourceFiles();
    // Floor: 1531 non-test .ts/.tsx files under src/ on 2026-10-21.
    expect(files.length).toBeGreaterThan(1400);
    for (const file of files) {
      stripComments(repoFile(file))
        .split("\n")
        .forEach((line, i) => {
          if (!HEX.test(line) || !STATUS_CONTEXT.test(line)) return;
          if (/resolveToken|issue #|PR #|task #|Closes #/.test(line)) return;
          if (ALLOWED_FILES.has(file)) {
            allowedHits.set(file, (allowedHits.get(file) ?? 0) + 1);
            return;
          }
          offenders.push(
            `${file}:${i + 1} — "${line.trim().slice(0, 100)}" paints a status/step colour ` +
              `from a hex literal. It cannot follow the theme, cannot be checked against ` +
              `JOB_STATUS_COLORS, and is invisible to every colour rule in this file. ` +
              `Use hsl(var(--token)) via src/lib/statusColors.ts.`,
          );
        });
    }
    expect(offenders, "hex-literal status colours:\n  " + offenders.join("\n  ")).toEqual([]);
    // TWO-WAY: an allowlisted file that no longer has a single hex line the
    // rule would flag is excused for nothing — and would silently excuse the
    // next status hex written there.
    const staleAllowed = [...ALLOWED_FILES].filter((f) => !allowedHits.get(f));
    expect(
      staleAllowed.map((f) => `stale baseline entry ${f} — remove it (lower the baseline)`),
    ).toEqual([]);
  });

  it("the token map is complete and every value is a token reference", () => {
    for (const status of Constants.public.Enums.job_status) {
      const c = JOB_STATUS_COLORS[status];
      expect(c, `JOB_STATUS_COLORS has no entry for "${status}"`).toBeDefined();
      for (const [k, v] of Object.entries(c)) {
        expect(
          v,
          `JOB_STATUS_COLORS.${status}.${k} = "${v}" is not an hsl(var(--token)) reference — ` +
            `a literal here is a theme-blind colour hidden inside the map that is supposed ` +
            `to prevent them`,
        ).toMatch(/^hsl\(var\(--[\w-]+\)/);
      }
    }
    expect(FALLBACK_STATUS_COLOR.bg).toMatch(/^hsl\(var\(--/);
  });

  it("no status uses the DANGER token — this brand has no alarm red for a status", () => {
    // statusColors.ts states the voice explicitly: "no red-alarm", and
    // `disputed` is deliberately kept in the sienna family. A future edit that
    // reaches for --destructive on a status chip is a voice change, and it
    // should have to argue with this line to make it.
    const wrong = Object.entries(JOB_STATUS_COLORS).filter(([, c]) =>
      /--destructive|--error|--danger(?!-ink)/.test(`${c.bg} ${c.text}`),
    );
    expect(
      wrong.map(([s]) => s),
      `these statuses now paint in the danger/alarm family: ${wrong.map(([s]) => s).join(", ")}. ` +
        `statusColors.ts's stated voice is warm-earthy with NO alarm red — 'disputed' is ` +
        `"serious but warm", not red. If the voice changed, change the doc comment too.`,
    ).toEqual([]);
  });
});

// ===========================================================================
// 2 — the progress rail: one colour per meaning, at most one alarm
// ===========================================================================

/* The progress RAIL and its colour rule (jobRailTone.ts) are gone: the job tracker is the one four-segment
   <JobProgress> now (owner, 2026-10-21, src/test/oneJobTracker.test.ts), whose reached segments are the
   primary olive and which has no alarm step. */
