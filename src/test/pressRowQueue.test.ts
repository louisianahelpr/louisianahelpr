/**
 * nightly-red #1582 (run 36230166945, 2026-09-26): shard 4 of press-every-control
 * stopped at its 135-min budget with 12 rows NOT REACHED while shard 2 had
 * finished in 73 min and sat idle. The shards split the route list
 * round-robin (`k % 4`), blind to what a row costs: /admin?view=jobs alone took
 * 97 min (412 presses). Shard-time summed to ~430 of 540 minutes, so the work
 * fit; the split did not.
 *
 * The CLASS is "a static split of uneven work". Shards now CLAIM rows from one
 * shared queue (claimRow, an atomic mkdir), so a shard with time left takes
 * the next row. This guard holds:
 *   - a row can be claimed once, and a released row can be claimed again;
 *   - an earlier wave out of time STOPS (hands rows on), only the last wave
 *     reports rows as not reached;
 *   - the harness skips the static filter whenever a queue is set, and claims
 *     both walked rows and redirect rows;
 *   - press-wave.sh gives every shard of a run the same queue, and the
 *     workflow marks wave 1 as not last and wave 2 as last.
 *
 * @mutate scripts/audit/press-every-control.mjs | if (process.env.SHARD && !QUEUE_DIR) { | if (process.env.SHARD) {
 * @mutate scripts/audit/press-every-control.mjs | if (!claimRow({ dir: QUEUE_DIR, key: rowKey })) continue; | claimRow({ dir: QUEUE_DIR, key: rowKey });
 * @mutate scripts/audit/pressFailureClass.mjs | return lastWave ? "not-reached" : "stop"; | return "not-reached";
 * @mutate scripts/audit/pressFailureClass.mjs | if (e && e.code === "EEXIST") return false; | if (e && e.code === "EEXIST") return true;
 * @mutate scripts/audit/press-wave.sh | export PRESS_QUEUE_DIR="${PRESS_QUEUE_DIR:-test-results/press-queue/$RUN_BASE}" | export PRESS_QUEUE_DIR=""
 * @mutate .github/workflows/press-every-control.yml |           PRESS_LAST_WAVE: "1" |           PRESS_LAST_WAVE: "0"
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { claimRow, queuedRowAction, releaseRow } from "../../scripts/audit/pressFailureClass.mjs";
import { blankComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(REPO, p), "utf8");

describe("press shards claim rows from one queue (#1582)", () => {
  it("a row is claimed once; a released row can be claimed again", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "press-queue-")), "q");
    try {
      expect(claimRow({ dir, key: "007-admin" })).toBe(true);
      expect(claimRow({ dir, key: "007-admin" })).toBe(false);
      expect(claimRow({ dir, key: "007-helper" })).toBe(true);
      releaseRow({ dir, key: "007-admin" });
      expect(claimRow({ dir, key: "007-admin" })).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("only the last wave reports rows as not reached; an earlier wave hands them on", () => {
    expect(queuedRowAction({ overBudget: false, lastWave: false })).toBe("walk");
    expect(queuedRowAction({ overBudget: false, lastWave: true })).toBe("walk");
    expect(queuedRowAction({ overBudget: true, lastWave: false })).toBe("stop");
    expect(queuedRowAction({ overBudget: true, lastWave: true })).toBe("not-reached");
  });

  it("the harness claims every row and drops the static split when a queue is set", () => {
    const src = blankComments(read("scripts/audit/press-every-control.mjs"));
    expect(src).toContain("if (process.env.SHARD && !QUEUE_DIR) {");
    expect(src).toContain("if (!claimRow({ dir: QUEUE_DIR, key: rowKey })) continue;");
    expect(src).toMatch(/if \(QUEUE_DIR && !claimRow\(\{ dir: QUEUE_DIR, key: `\$\{String\(routeIdx\)\.padStart\(3, "0"\)\}-redirect` \}\)\) continue;/);
    // A row cut short in an earlier wave is handed back, not reported.
    expect(src).toContain("releaseRow({ dir: QUEUE_DIR, key: rowKey });");
    // The default is the safe one: a lone run reports what it did not reach.
    expect(src).toContain('const LAST_WAVE = process.env.PRESS_LAST_WAVE !== "0";');
  });

  it("every shard of a run shares one queue, and only the final wave is last", () => {
    const wave = read("scripts/audit/press-wave.sh");
    expect(wave).toContain('export PRESS_QUEUE_DIR="${PRESS_QUEUE_DIR:-test-results/press-queue/$RUN_BASE}"');

    const wf = parse(read(".github/workflows/press-every-control.yml"));
    const steps: Array<{ run?: string; env?: Record<string, string> }> = Object.values(
      wf.jobs as Record<string, { steps?: Array<{ run?: string; env?: Record<string, string> }> }>,
    ).flatMap((j) => j.steps ?? []);
    const waves = steps.filter((s) => /scripts\/audit\/press-wave\.sh/.test(s.run ?? ""));
    // Inventory floor: the run has more than one wave (else nothing is handed on).
    expect(waves.length).toBeGreaterThan(1);
    waves.forEach((s, i) => {
      expect(s.env?.PRESS_LAST_WAVE, `wave ${i + 1}`).toBe(i === waves.length - 1 ? "1" : "0");
    });
  });
});
