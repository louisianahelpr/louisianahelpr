/**
 * Guard: a GitHub Actions alert may never skip itself silently.
 *
 * 2026-09-14: db-deploy.yml, functions-deploy.yml and deploy.yml each posted
 * failures to `secrets.SLACK_WEBHOOK`, a secret that was never set, behind
 * `if: ... && env.SLACK_WEBHOOK != ''`. A step's own `env:` is not visible to
 * its `if:`, and the secret was empty anyway, so every failed deploy notified
 * nobody and the run log said "skipped". The Supabase side calls the same
 * webhook `SLACK_WEBHOOK_URL`, so two names described one secret.
 *
 * The class, checked across every workflow:
 *   1. no step gates on a Slack secret/env being non-empty in `if:` (a skip
 *      is silent by construction);
 *   2. the only Slack secret name is SLACK_WEBHOOK_URL;
 *   3. every step that reads SLACK_WEBHOOK_URL prints a `::warning` (or `::error`) when it
 *      is empty, so a missing secret is visible on the run page.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.cwd(), ".github", "workflows");

/** Split a workflow into rough step blocks: each starts at a `- name:` / `- uses:` / `- run:` item. */
function steps(src: string): string[] {
  const lines = src.split("\n");
  const out: string[] = [];
  let cur: string[] | null = null;
  let indent = -1;
  for (const line of lines) {
    const m = /^(\s*)- (name|uses|run|id|if):/.exec(line);
    if (m && (cur === null || m[1].length <= indent)) {
      if (cur) out.push(cur.join("\n"));
      cur = [line];
      indent = m[1].length;
    } else if (cur) {
      cur.push(line);
    }
  }
  if (cur) out.push(cur.join("\n"));
  return out;
}

export function slackWorkflowViolations(files: Record<string, string>): string[] {
  const v: string[] = [];
  for (const [file, src] of Object.entries(files)) {
    for (const m of src.matchAll(/secrets\.(SLACK_[A-Z_]+)/g)) {
      if (m[1] !== "SLACK_WEBHOOK_URL") v.push(`${file}: uses secrets.${m[1]} (the one name is SLACK_WEBHOOK_URL)`);
    }
    for (const line of src.split("\n")) {
      if (/^\s*if:.*(env|secrets)\.SLACK_/.test(line)) {
        v.push(`${file}: step if: gates on a Slack secret, so a missing secret skips silently: ${line.trim()}`);
      }
    }
    for (const step of steps(src)) {
      if (/secrets\.SLACK_WEBHOOK_URL/.test(step) && !/::(warning|error)/.test(step)) {
        const name = /- name:\s*(.*)/.exec(step)?.[1] ?? "(unnamed step)";
        v.push(`${file}: step "${name}" reads SLACK_WEBHOOK_URL but never prints ::warning or ::error when it is empty`);
      }
    }
  }
  return v;
}

describe("Slack alerts in GitHub workflows are never silently skipped", () => {
  it("every workflow passes", () => {
    const files: Record<string, string> = {};
    for (const f of readdirSync(DIR)) {
      if (f.endsWith(".yml") || f.endsWith(".yaml")) files[f] = readFileSync(join(DIR, f), "utf8");
    }
    // FLOOR, on the CONSTRUCT count, not just the file count: an empty
    // workflows directory, or a repo where nothing posts to Slack any more,
    // would pass this whole guard vacuously. 42 workflows today, 6 of which
    // read SLACK_WEBHOOK_URL.
    expect(Object.keys(files).length, "no workflows parsed — the inventory is broken").toBeGreaterThanOrEqual(40);
    const slackSteps = Object.values(files).flatMap((src) =>
      steps(src).filter((st) => /secrets\.SLACK_WEBHOOK_URL/.test(st)),
    );
    expect(slackSteps.length, "no workflow reads SLACK_WEBHOOK_URL — rules 1 and 3 would pass vacuously").toBeGreaterThanOrEqual(6);
    expect(slackWorkflowViolations(files)).toEqual([]);
  });

  it("is able to fail: the 2026-09-14 notify step is caught on all three counts", () => {
    const original = `
jobs:
  deploy:
    steps:
      - name: Notify on failure
        if: failure() && steps.precheck.outputs.skip != 'true' && env.SLACK_WEBHOOK != ''
        env:
          SLACK_WEBHOOK: \${{ secrets.SLACK_WEBHOOK }}
        run: |
          curl -X POST --data '{}' "$SLACK_WEBHOOK" || true
      - name: Renamed but still silent
        env:
          SLACK_WEBHOOK_URL: \${{ secrets.SLACK_WEBHOOK_URL }}
        run: curl -X POST "$SLACK_WEBHOOK_URL" || true
`;
    const v = slackWorkflowViolations({ "db-deploy.yml": original });
    expect(v.some((x) => x.includes("secrets.SLACK_WEBHOOK "))).toBe(true);
    expect(v.some((x) => x.includes("gates on a Slack secret"))).toBe(true);
    expect(v.some((x) => x.includes("never prints ::warning or ::error"))).toBe(true);
  });
});

// PROVEN RED 2026-09-21, one per rule (all three fail "every workflow passes"):
//   1. wrong secret name  -> "db-deploy.yml: uses secrets.SLACK_WEBHOOK …"
//   2. if:-gated on it    -> "db-deploy.yml: step if: gates on a Slack secret …"
//   3. no ::warning       -> "slack-test.yml: step \"Post test message\" reads
//                             SLACK_WEBHOOK_URL but never prints ::warning …"
// SOURCE-TEXT PIN: it reads workflow YAML, never GitHub. It cannot tell whether
// the SLACK_WEBHOOK_URL repo secret is actually set, nor whether Slack accepts
// it — slack-test.yml (workflow_dispatch) is the only live proof of that.
// @mutate .github/workflows/db-deploy.yml | SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }} | SLACK_WEBHOOK: ${{ secrets.SLACK_WEBHOOK }}
// @mutate .github/workflows/db-deploy.yml | if: failure() && steps.precheck.outputs.skip != 'true' | if: failure() && steps.precheck.outputs.skip != 'true' && env.SLACK_WEBHOOK_URL != ''
// @mutate .github/workflows/slack-test.yml | echo "::error::SLACK_WEBHOOK_URL is not set" | echo "SLACK_WEBHOOK_URL is not set"
