/**
 * A drift check compares the repo with prod as it is NOW, so its repo side must
 * be main's tip, not the commit its run started on: a re-run reuses that old
 * commit, and on 2026-10-06 that filed a false "7 unrecorded migrations" (#2422).
 * Inventory: every scheduled workflow that diffs migrations or definer grants
 * against prod.
 *
 * @mutate .github/workflows/db-drift-detect.yml | ref: main | ref: ${{ github.sha }}
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readdirSync } from "./helpers/trackedFiles";

const ROOT = join(__dirname, "..", "..");
const DIR = join(ROOT, ".github", "workflows");
const COMPARES_PROD = /supabase migration list|definer-exec-allowlist|ban-gate-coverage/;

describe("drift checks read main's tip", () => {
  const scheduled = readdirSync(DIR)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => ({ f, src: readFileSync(join(DIR, f), "utf8") }))
    .filter(({ src }) => /^\s+schedule:/m.test(src) && COMPARES_PROD.test(src));

  it("finds the scheduled drift checks", () => {
    expect(scheduled.map((w) => w.f)).toContain("db-drift-detect.yml");
  });

  it("each checks out ref: main in the job that compares", () => {
    for (const { f, src } of scheduled) {
      const jobs = src.split(/\n  (?=[a-z][\w-]*:\n)/);
      const comparing = jobs.filter((j) => COMPARES_PROD.test(j) && /actions\/checkout@/.test(j));
      expect(comparing.length, `${f}: no job both checks out and compares`).toBeGreaterThan(0);
      for (const j of comparing) {
        expect(j, `${f}: a comparing job checks out the run's own commit; add \`ref: main\``).toMatch(/actions\/checkout@[^\n]*\n\s+with:\n(?:\s+#[^\n]*\n)*\s+ref: main\b/);
      }
    }
  });
});
