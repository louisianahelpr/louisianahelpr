/*
 * CLASS GUARD (Q703): a CANCELLED run must not report to its nightly-red issue.
 *
 * Found 2026-09-26: e2e-journeys run 36211786791 was cancelled before any test
 * ran, and its notify job (`if: always() && ...`) still commented "Still red"
 * on #1719 (issuecomment-5842376019, corrected by hand in 5842380793). The
 * status it passes is `success` only when every suite job succeeded, so a
 * cancelled suite reads as a failure. A cancelled run earned nothing either
 * way.
 *
 * THE RULE: the job that runs ./.github/actions/nightly-issue-sync gates on
 * `!cancelled()`, never bare `always()`. `!cancelled()` still runs after a
 * failed suite (that is the report), but not when the run was cancelled. A
 * suite job killed by its own timeout-minutes does not cancel the run, so a
 * timeout still reports as a red.
 *
 * INVENTORY: every workflow job that uses the action, read from source.
 * STILL_ALWAYS is the exact list of reporters that keep `always()`; it is
 * two-way (a reporter that moves off always() must leave the list in the same
 * commit). They were not changed with Q703 because some are scheduled monitors
 * whose workflow-level cancellation Q591 wants MORE visible, not less; each
 * should be decided on its own.
 */

// @mutate .github/workflows/e2e-journeys.yml | !cancelled() && github.ref == 'refs/heads/main' && (github.event_name == 'schedule' | always() && github.ref == 'refs/heads/main' && (github.event_name == 'schedule'

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const WORKFLOWS = join(__dirname, "..", "..", ".github", "workflows");

/** YAML `#` comments (whole-line and trailing) removed; not a JS scanner. */
function stripYamlComments(src: string): string {
  return src
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .map((l) => l.replace(/\s+#.*$/, ""))
    .join("\n");
}

function jobBlocks(src: string): Record<string, string> {
  const lines = stripYamlComments(src).split("\n");
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  const out: Record<string, string> = {};
  if (start < 0) return out;
  let id: string | null = null;
  let buf: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() !== "" && !/^\s/.test(l)) break;
    const m = /^ {2}([A-Za-z_][\w-]*):\s*$/.exec(l);
    if (m) {
      if (id) out[id] = buf.join("\n");
      id = m[1];
      buf = [];
      continue;
    }
    if (id) buf.push(l);
  }
  if (id) out[id] = buf.join("\n");
  return out;
}

function jobIf(block: string): string {
  const lines = block.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^ {4}if:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const head = m[1].trim();
    if (head !== "" && !/^[>|][-+]?$/.test(head)) return head;
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === "") continue;
      if (!/^ {5,}/.test(lines[j])) break;
      body.push(lines[j].trim());
    }
    return body.join(" ");
  }
  return "";
}

/** Reporters still gated on bare always(), exact (2026-09-27). */
const STILL_ALWAYS: readonly string[] = [
  "a11y-webkit-prod.yml",
  "app-store-reviews.yml",
  "broken-links.yml",
  "core-loop-canary.yml",
  "db-backup.yml",
  "db-drift-detect.yml",
  "db-restore-drill.yml",
  "e2e-abuse-notifications.yml",
  "e2e-real-backend.yml",
  "edge-function-smoke.yml",
  "expiry-monitor.yml",
  "lighthouse.yml",
  "loading-states-refresh.yml",
  "morning-page.yml",
  "nightly-red-age.yml",
  "nightly-webkit.yml",
  "open-done-when.yml",
  "press-every-control.yml",
  "privacy-journey.yml",
  "prod-audit.yml",
  "prod-deploy.yml",
  "prod-errors.yml",
  "prod-freshness.yml",
  "quota-monitor.yml",
  "race-runner.yml",
  "schedule-heartbeat.yml",
  "scoreboard.yml",
  "security-audit.yml",
  "slow-network.yml",
  "staleness-watch.yml",
  "stripe-webhook-guard.yml",
  "supabase-usage.yml",
  "ui-sweep.yml",
  "vacuity.yml",
  "write-contract-refresh.yml",
];

describe("a cancelled run does not report to its nightly-red issue", () => {
  const reporters: { file: string; job: string; cond: string }[] = [];
  for (const f of readdirSync(WORKFLOWS).filter((x) => /\.ya?ml$/.test(x)).sort()) {
    const blocks = jobBlocks(readFileSync(join(WORKFLOWS, f), "utf8"));
    for (const [job, block] of Object.entries(blocks)) {
      if (block.includes("nightly-issue-sync")) reporters.push({ file: f, job, cond: jobIf(block) });
    }
  }
  const bareAlways = [...new Set(reporters.filter((r) => /(^|[^!\w])always\(\)/.test(r.cond)).map((r) => r.file))].sort();

  it("reads the reporting jobs (floor)", () => {
    expect(reporters.length).toBeGreaterThan(30);
    expect(reporters.map((r) => r.file)).toContain("e2e-journeys.yml");
  });

  it("e2e-journeys' notify gates on !cancelled(), not always()", () => {
    const r = reporters.find((x) => x.file === "e2e-journeys.yml");
    expect(r?.cond).toMatch(/^!cancelled\(\)/);
    expect(bareAlways).not.toContain("e2e-journeys.yml");
  });

  it("STILL_ALWAYS is exact, both ways", () => {
    expect(bareAlways).toEqual([...STILL_ALWAYS].sort());
  });
});
