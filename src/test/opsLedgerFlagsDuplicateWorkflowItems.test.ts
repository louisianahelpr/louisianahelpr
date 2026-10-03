/**
 * One workflow, two open ledger items (2026-09-27): quota-monitor was open as
 * nightly_red 79f3fe46 ("nightly-red: quota-monitor", from its nightly-red
 * issue) AND as workflow d2df1e5e (source quota-monitor, verify_ref
 * quota-monitor.yml, from its own record step). Each closes on a different
 * detector, so one red counted twice and could half-close. `list` now ends
 * with POSSIBLE DUPLICATES and prod-errors.yml runs it with --fail-on-dupes.
 *
 * @mutate scripts/lib/opsAlertLedger.mjs | .filter(([, items]) => items.length > 1 && | .filter(([, items]) => items.length > 2 &&
 * @mutate scripts/lib/opsAlertLedger.mjs | k = String(r.title).replace(/^(nightly-red:\s*\|main:\s*)+/i, ""); | k = String(r.title);
 * @mutate scripts/lib/opsAlertLedger.mjs | for (const m of String(text).matchAll(/workflow-name: | for (const m of [].values(/workflow-name:
 * @mutate scripts/ops-alert-ledger.mjs | if (flag("fail-on-dupes") && failing.length) process.exit(1); | if (flag("fail-on-dupes") && failing.length) process.exit(0);
 * @mutate scripts/lib/opsAlertLedger.mjs |   return dupes.filter((g) => g.workflow !== self); |   return dupes.filter((g) => g.workflow === self);
 *
 * 2026-10-03: a group keyed to the workflow RUNNING the check (prod-errors'
 * own nightly_red 7cba5a56 + 42166b2c "Sentry alerts are not synced", verify
 * prod-errors.yml) closes only on a green prod-errors run; failing on it kept
 * prod-errors red on nothing else (run 37123912578). It is reported, not
 * failed on; every other group still fails the run.
 * @mutate .github/workflows/prod-errors.yml | node scripts/ops-alert-ledger.mjs list --fail-on-dupes | node scripts/ops-alert-ledger.mjs list
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
// @ts-expect-error untyped .mjs (same as opsLedgerNightlyItemsCanClose.test.ts)
import { duplicateGroups, dupesThatFail, runningWorkflowKey, workflowAliases } from "../../scripts/lib/opsAlertLedger.mjs";

const ROOT = resolve(__dirname, "../..");
const WF = join(ROOT, ".github/workflows");
const ALIASES = workflowAliases(
  readdirSync(WF).filter((f) => /\.ya?ml$/.test(f)).map((f) => ({ file: f, text: readFileSync(join(WF, f), "utf8") })),
);

// The live rows, as `list` read them on 2026-09-27.
const QUOTA_NIGHTLY = { id: "79f3fe46-3bcb-4fea-aad5-7460a6f755ba", source_kind: "nightly_red", source: "nightly-red", title: "nightly-red: quota-monitor", verify_ref: "nightly-red: quota-monitor" };
const QUOTA_WORKFLOW = { id: "d2df1e5e-097f-4276-857c-3dcbdca8af82", source_kind: "workflow", source: "quota-monitor", title: "quota: sentry session replays sent", verify_ref: "quota-monitor.yml" };
const VITEST_NIGHTLY = { id: "e69d074b", source_kind: "nightly_red", source: "nightly-red", title: "nightly-red: main: vitest", verify_ref: "nightly-red: main: Vitest" };
const LEDGER_WORKFLOW = { id: "42166b2c", source_kind: "workflow", source: "ops-alert-ledger", title: "sentry alerts are not synced", verify_ref: "prod-errors.yml" };
const PUSH_SQL = { id: "465c4dd5", source_kind: "error_logs", source: "push-tokens-empty", title: "no device can receive a push", verify_ref: "push-tokens-empty" };

describe("ops alert ledger: possible duplicates", () => {
  it("aliases resolve a workflow's file base, name: and nightly-issue-sync workflow-name", () => {
    // Floor: 61 workflow files on 2026-09-27; an empty read would alias nothing.
    expect(ALIASES.size).toBeGreaterThan(60);
    expect(ALIASES.get("quota-monitor")).toBe("quota-monitor");
    expect(ALIASES.get("quota and analytics monitors")).toBe("quota-monitor");
    expect(ALIASES.get("vitest")).toBe("vitest");
    expect(ALIASES.get("open-done-when")).toBe("open-done-when");
  });

  it("RED: the live quota-monitor pair is one group", () => {
    const g = duplicateGroups([QUOTA_NIGHTLY, QUOTA_WORKFLOW, VITEST_NIGHTLY, LEDGER_WORKFLOW, PUSH_SQL], ALIASES);
    expect(g.map((x: { workflow: string }) => x.workflow)).toEqual(["quota-monitor"]);
    expect(g[0].items.map((r: { id: string }) => r.id)).toEqual([QUOTA_NIGHTLY.id, QUOTA_WORKFLOW.id]);
  });

  it("a workflow-name that differs from the file base still matches", () => {
    const a = workflowAliases([{ file: "nightly-webkit.yml", text: "name: WebKit\n  workflow-name: a11y-webkit-prod\n" }]);
    const g = duplicateGroups(
      [
        { id: "a", source_kind: "nightly_red", source: "nightly-red", title: "nightly-red: a11y-webkit-prod", verify_ref: "" },
        { id: "b", source_kind: "workflow", source: "whatever", title: "t", verify_ref: "nightly-webkit.yml" },
      ],
      a,
    );
    expect(g.map((x: { workflow: string }) => x.workflow)).toEqual(["nightly-webkit"]);
  });

  it("GREEN: without the duplicate there is nothing to flag", () => {
    expect(duplicateGroups([QUOTA_WORKFLOW, VITEST_NIGHTLY, LEDGER_WORKFLOW, PUSH_SQL], ALIASES)).toEqual([]);
    expect(duplicateGroups([QUOTA_NIGHTLY, VITEST_NIGHTLY, LEDGER_WORKFLOW, PUSH_SQL], ALIASES)).toEqual([]);
  });

  it("two workflow items of one workflow are separate alerts, not duplicates", () => {
    const other = { ...QUOTA_WORKFLOW, id: "x", title: "quota: posthog events" };
    expect(duplicateGroups([QUOTA_WORKFLOW, other], ALIASES)).toEqual([]);
  });

  it("list prints POSSIBLE DUPLICATES and --fail-on-dupes exits 1", () => {
    const cli = blankComments(readFileSync(join(ROOT, "scripts/ops-alert-ledger.mjs"), "utf8"));
    const list = cli.slice(cli.indexOf("async function list()"), cli.indexOf("async function record()"));
    expect(list).toMatch(/duplicateGroups\(rows,/);
    expect(list).toContain("POSSIBLE DUPLICATES");
    expect(list).toMatch(/const failing = dupesThatFail\(dupes, runningWorkflowKey\(process\.env, aliases\)\)|const self = runningWorkflowKey\(process\.env, aliases\);\s*const failing = dupesThatFail\(dupes, self\);/);
    expect(list).toMatch(/if \(flag\("fail-on-dupes"\) && failing\.length\) process\.exit\(1\);/);
  });

  it("prod-errors.yml lists with --fail-on-dupes", () => {
    const wf = readFileSync(join(WF, "prod-errors.yml"), "utf8");
    expect(wf).toMatch(/^\s+node scripts\/ops-alert-ledger\.mjs list --fail-on-dupes\b/m);
  });
});

describe("ops alert ledger: the running workflow's own pair is reported, not failed on (2026-10-03)", () => {
  const PROD_ERRORS_NIGHTLY = { id: "7cba5a56-3a57-42f8-b59b-c61f9b6e7b64", source_kind: "nightly_red", source: "nightly-red", title: "nightly-red: prod-errors", verify_ref: "nightly-red: prod-errors" };
  const IN_PROD_ERRORS = { GITHUB_WORKFLOW_REF: "louisianahelpr/louisianahelpr/.github/workflows/prod-errors.yml@refs/heads/main" };

  it("RED before: the live 12:45Z pair is a duplicate group keyed to prod-errors itself", () => {
    const g = duplicateGroups([PROD_ERRORS_NIGHTLY, LEDGER_WORKFLOW], ALIASES);
    expect(g.map((x: { workflow: string }) => x.workflow)).toEqual(["prod-errors"]);
  });

  it("inside prod-errors.yml that group does not fail the run; another workflow's pair still does", () => {
    expect(runningWorkflowKey(IN_PROD_ERRORS, ALIASES)).toBe("prod-errors");
    const own = duplicateGroups([PROD_ERRORS_NIGHTLY, LEDGER_WORKFLOW], ALIASES);
    expect(dupesThatFail(own, runningWorkflowKey(IN_PROD_ERRORS, ALIASES))).toEqual([]);
    const both = duplicateGroups([PROD_ERRORS_NIGHTLY, LEDGER_WORKFLOW, QUOTA_NIGHTLY, QUOTA_WORKFLOW], ALIASES);
    expect(dupesThatFail(both, "prod-errors").map((x: { workflow: string }) => x.workflow)).toEqual(["quota-monitor"]);
  });

  it("outside Actions nothing is exempt", () => {
    expect(runningWorkflowKey({}, ALIASES)).toBeNull();
    const own = duplicateGroups([PROD_ERRORS_NIGHTLY, LEDGER_WORKFLOW], ALIASES);
    expect(dupesThatFail(own, runningWorkflowKey({}, ALIASES))).toHaveLength(1);
  });
});
