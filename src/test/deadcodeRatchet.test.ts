// @mutate src/lib/storagePath.ts | export function safeDocumentUrl( | export const vacuityUnusedProbe = 1; export function safeDocumentUrl(
// @mutate src/components/HelprMark.tsx | export default HelprMark; | export default HelprMark; export { HelprMark as HelprMarkAlias };
/*
 * The unused-export count may only go DOWN.
 *
 * WHY A RATCHET AND NOT A DELETE. CLAUDE.md: "Dead or no-op code you notice is a
 * REPORT, not a task" — an export knip calls unused can still be reached by a
 * dynamic import, a test, or a runtime global knip cannot see, so nothing here
 * deletes anything. knip.json keeps `exports`/`types` at "warn" for the same
 * reason. But a warning nobody reads grew to 160 unused exports + 22 unused types
 * by 2026-09-22, and a session kept having to count them by hand.
 *
 * So: the current counts live in scripts/deadcode-baseline.json. A commit that
 * ADDS an unused export fails here (remove it, or use it). A commit that removes
 * one fails too, until the baseline is lowered to match — so the number can never
 * silently drift back up to where it was. Same shape as the legacy lists that
 * may only shrink (deletingStripperLegacyOnlyShrinks.test.ts).
 *
 * PD-004 (2026-09-24): `duplicates` joined the ratchet — a symbol exported
 * twice (default + named, or two names) is the same class of drift. Most are
 * default exports React.lazy or the email renderer needs, so none is removed here.
 *
 * See the list: `npx knip --include exports,types,duplicates`.
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const BASELINE_PATH = "scripts/deadcode-baseline.json";
const baseline: { exports: number; types: number; duplicates: number } = JSON.parse(
  readFileSync(join(root, BASELINE_PATH), "utf8"),
);

type KnipIssue = { file: string; exports: { name: string }[]; types: { name: string }[]; duplicates?: unknown[] };

function measure(): { exports: number; types: number; duplicates: number } {
  const raw = execFileSync(
    "npx",
    ["knip", "--include", "exports,types,duplicates", "--reporter", "json", "--no-exit-code"],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 },
  );
  const { issues } = JSON.parse(raw) as { issues: KnipIssue[] };
  // A knip that ran on nothing would report 0 and "pass" by lowering the bar.
  expect(Array.isArray(issues)).toBe(true);
  expect(issues.length, "knip reported no files at all").toBeGreaterThan(0);
  return {
    exports: issues.reduce((n, i) => n + i.exports.length, 0),
    types: issues.reduce((n, i) => n + i.types.length, 0),
    duplicates: issues.reduce((n, i) => n + (i.duplicates?.length ?? 0), 0),
  };
}

describe("unused exports only shrink", () => {
  it("baseline is a real pair of positive counts", () => {
    expect(Number.isInteger(baseline.exports) && baseline.exports > 0).toBe(true);
    expect(Number.isInteger(baseline.types) && baseline.types >= 0).toBe(true);
    expect(Number.isInteger(baseline.duplicates) && baseline.duplicates >= 0).toBe(true);
  });

  it("knip's unused export/type counts equal the baseline", { timeout: 180_000 }, () => {
    const now = measure();
    for (const kind of ["exports", "types", "duplicates"] as const) {
      const was = baseline[kind];
      const is = now[kind];
      expect(
        is,
        is > was
          ? `Unused ${kind} ROSE from ${was} to ${is}. Something newly exported is used by nothing. ` +
              `Run \`npx knip --include exports,types,duplicates\`, find the new entry, and remove the export ` +
              `(or use it). Do not raise ${BASELINE_PATH}.`
          : `Unused ${kind} FELL from ${was} to ${is} — good. Lower "${kind}" in ${BASELINE_PATH} ` +
              `to ${is} in this commit so the ratchet holds the gain.`,
      ).toBe(was);
    }
  });
});
