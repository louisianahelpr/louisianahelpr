// @mutate scripts/lib/alertIssueLabels.mjs | "schedule-stalled": { severity: "error", filedBy: "schedule-heartbeat.yml" }, |
// @mutate scripts/lib/alertIssueLabels.mjs | "migration-drift": { severity: "error", filedBy: "db-drift-detect.yml" }, | "migration-drift": { severity: "error", filedBy: null },
// @mutate scripts/ops-alert-ledger.mjs | for (const label of ALERT_LABELS) { | for (const label of ["nightly-red", "prod-down", "prod-errors", "supabase-usage"]) {
// @mutate scripts/lib/openFeeds.mjs |   for (const label of ALERT_LABELS) { |   for (const label of ["nightly-red"]) {
// @mutate scripts/lib/openFeeds.mjs | origin: `${label} issue #${i.number}`, | origin: `nightly-red issue #${i.number}`,
/*
 * CLASS GUARD (issue #2196): every label a workflow FILES an issue under is
 * mirrored into the ops alert ledger AND docs/OPEN.md, or is named as not an
 * alert, with why.
 *
 * Measured on main 2026-10-03: the ledger sync tracked nightly-red, prod-down,
 * prod-errors and supabase-usage by hand, and the OPEN.md feed tracked
 * nightly-red only. schedule-heartbeat.yml files `schedule-stalled` (#2196,
 * open since 15:10Z) and db-drift-detect.yml files `migration-drift`; neither
 * reached either list, so an open alert lived only on GitHub.
 *
 * The labels are DERIVED here from the workflow files: the `label:` each
 * nightly-issue-sync step passes (else the action's default), every
 * `gh issue create --label` in a run script (shell variables resolved), and
 * every `issues.create({ labels: [...] })` in a github-script step. That set
 * must equal scripts/lib/alertIssueLabels.mjs (ALERT_ISSUE_LABELS plus
 * NOT_ALERT_LABELS), both ways, with each label's filing workflow right; and
 * both mirrors and the done-when checker must read that table.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { blankComments } from "./helpers/blankNonCode";
import { ALERT_ISSUE_LABELS, ALERT_LABELS, NOT_ALERT_LABELS, alertWorkflowOf } from "../../scripts/lib/alertIssueLabels.mjs";
import { groupSources, openAlertIssues } from "../../scripts/lib/openFeeds.mjs";
// @ts-expect-error - plain .mjs tool script, no types
import { issueMarkerHolds } from "../../scripts/open-done-when.mjs";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const WORKFLOWS = ".github/workflows";
const SYNC_ACTION = "./.github/actions/nightly-issue-sync";

type Step = { uses?: string; with?: Record<string, unknown>; run?: string; env?: Record<string, unknown> };
type Workflow = { jobs?: Record<string, { steps?: Step[] } | null> };

/** The label each `--label` of a `gh issue create` in this shell script resolves to. */
function shellCreateLabels(run: string, env: Record<string, unknown> = {}): string[] {
  const script = run.replace(/\\\n\s*/g, " ");
  const vars = new Map<string, string>();
  for (const [k, v] of Object.entries(env)) if (typeof v === "string" && !v.includes("${{")) vars.set(k, v);
  for (const m of script.matchAll(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)=(?:"([^"$]*)"|'([^']*)'|([^\s"'$;]+))\s*$/gm)) vars.set(m[1], m[2] ?? m[3] ?? m[4] ?? "");
  const out: string[] = [];
  for (const line of script.split("\n").filter((l) => /\bgh issue create\b/.test(l) && !/^\s*#/.test(l))) {
    for (const m of line.matchAll(/--label[ =]("[^"]*"|'[^']*'|\S+)/g)) {
      const tok = m[1].replace(/^["']|["']$/g, "");
      const v = /^\$\{?([A-Z_][A-Z0-9_]*)\}?$/.exec(tok);
      out.push(v ? (vars.get(v[1]) ?? `<unresolved ${tok}>`) : tok);
    }
  }
  return out;
}

/** Labels of every `issues.create({ ... labels: [...] })` in a github-script body. */
function scriptCreateLabels(script: string): string[] {
  const out: string[] = [];
  for (const m of script.matchAll(/issues\.create\(\{([\s\S]*?)\}\)/g)) {
    const labels = /labels:\s*\[([^\]]*)\]/.exec(m[1]);
    if (!labels) out.push("<issues.create without a labels array>");
    else for (const s of labels[1].matchAll(/["'`]([^"'`]+)["'`]/g)) out.push(s[1]);
  }
  return out;
}

/** label -> the workflow files that file issues under it. */
function filedLabels(): Map<string, Set<string>> {
  const action = parse(read(".github/actions/nightly-issue-sync/action.yml")) as { inputs: { label: { default: string } } };
  const out = new Map<string, Set<string>>();
  const add = (label: string, file: string) => out.set(label, new Set([...(out.get(label) ?? []), file]));
  for (const file of readdirSync(join(ROOT, WORKFLOWS)).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    const wf = parse(read(`${WORKFLOWS}/${file}`)) as Workflow;
    for (const job of Object.values(wf.jobs ?? {})) {
      for (const s of job?.steps ?? []) {
        if (s.uses === SYNC_ACTION) add(String(s.with?.label ?? action.inputs.label.default), file);
        if (typeof s.run === "string") for (const l of shellCreateLabels(s.run, s.env)) add(l, file);
        if (typeof s.with?.script === "string") for (const l of scriptCreateLabels(s.with.script)) add(l, file);
      }
    }
  }
  return out;
}

describe("every label a workflow files issues under reaches the ledger and OPEN.md", () => {
  const filed = filedLabels();

  it("derives the labels from the workflow files (floor)", () => {
    expect(filed.size).toBeGreaterThan(5);
    expect(filed.get("nightly-red")?.size ?? 0).toBeGreaterThan(20);
    expect([...(filed.get("schedule-stalled") ?? [])]).toEqual(["schedule-heartbeat.yml"]);
    expect([...(filed.get("privacy-journey-marker") ?? [])]).toEqual(["privacy-journey.yml"]);
    expect([...filed.keys()].filter((l) => l.startsWith("<")), "a label the derivation could not read").toEqual([]);
  });

  it("no script outside the workflows files issues (the derivation reads only workflows)", () => {
    const hits: string[] = [];
    let scanned = 0;
    const walk = (dir: string) => {
      for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(p);
        else if (/\.(mjs|js|cjs|sh|ts)$/.test(e.name)) {
          scanned++;
          const src = blankComments(read(p));
          if (/["']issue["'],\s*["']create["']|\bgh issue create\b|issues\.create\(/.test(src)) hits.push(p);
        }
      }
    };
    walk("scripts");
    expect(scanned).toBeGreaterThan(200);
    expect(hits, "teach filedLabels() to read the labels this script files under").toEqual([]);
  });

  it("is the alert-label table, both ways", () => {
    const notMirrored = [...filed.keys()].filter((l) => !(l in ALERT_ISSUE_LABELS) && !(l in NOT_ALERT_LABELS));
    const notFiled = ALERT_LABELS.filter((l) => !filed.has(l));
    const staleNotAlert = Object.keys(NOT_ALERT_LABELS).filter((l) => !filed.has(l));
    expect(notMirrored, "add it to ALERT_ISSUE_LABELS (or NOT_ALERT_LABELS, with why)").toEqual([]);
    expect(notFiled, "no workflow files this label any more: remove it").toEqual([]);
    expect(staleNotAlert).toEqual([]);
    expect(ALERT_LABELS.filter((l) => l in NOT_ALERT_LABELS)).toEqual([]);
  });

  it("names, for each label, the workflow whose own run closes its issue", () => {
    for (const l of ALERT_LABELS) {
      const by = ALERT_ISSUE_LABELS[l].filedBy;
      const files = [...(filed.get(l) ?? [])];
      if (by === null) expect(files.length, `${l} is per-workflow (title names it)`).toBeGreaterThan(1);
      else expect(files, l).toEqual([by]);
    }
    expect(alertWorkflowOf({ title: "🔴 3 scheduled workflow(s) have stopped running", labels: [{ name: "schedule-stalled" }] })).toBe("schedule-heartbeat.yml");
    expect(alertWorkflowOf({ title: "nightly-red: vacuity", labels: ["nightly-red"] }, () => "vacuity.yml")).toBe("vacuity.yml");
    expect(alertWorkflowOf({ title: "x", labels: ["owner-question"] })).toBeNull();
  });

  it("the ledger sync lists the open issues of every alert label", () => {
    const src = blankComments(read("scripts/ops-alert-ledger.mjs"));
    const i = src.indexOf("for (const label of ALERT_LABELS) {");
    expect(i, "ops-alert-ledger.mjs sync must iterate ALERT_LABELS").toBeGreaterThan(0);
    expect(src.slice(i, i + 300)).toMatch(/gh\(\["issue", "list", "--repo", repo, "--label", label, "--state", "open"/);
    expect(src).toMatch(/import \{[^}]*\bALERT_LABELS\b[^}]*\} from "\.\/lib\/alertIssueLabels\.mjs"/);
  });

  it("the OPEN.md feed lists the open issues of every alert label, one item per issue", () => {
    const asked: string[] = [];
    const got = openAlertIssues((label: string) => {
      asked.push(label);
      if (label === "schedule-stalled") return [{ number: 2196, title: "🔴 3 scheduled workflow(s) have stopped running" }];
      if (label === "nightly-red") return [{ number: 2197, title: "nightly-red: schedule-heartbeat" }];
      return [];
    });
    expect(asked).toEqual(ALERT_LABELS);
    expect(got).toEqual([
      { number: 2196, title: "🔴 3 scheduled workflow(s) have stopped running", label: "schedule-stalled" },
      { number: 2197, title: "nightly-red: schedule-heartbeat", label: "nightly-red" },
    ]);
    expect(blankComments(read("scripts/open-sync-trackers.mjs"))).toMatch(/snap\.issues = \{ readable: true, open: openAlertIssues\(list\) \}/);
    // The issue and its ledger row are ONE source: one item, both tags, the issue's done-when.
    const ledger = [{ fingerprint: "abcdef0123456789", source_kind: "nightly_red", source: "schedule-stalled", title: "🔴 3 scheduled workflow(s) have stopped running", sample_ref: { issue: 2196 } }];
    const groups = groupSources({ ledger, issues: got });
    const g = groups.find((x) => x.keys.includes("issue #2196"));
    expect(g?.keys).toEqual(["issue #2196", "ledger abcdef012345"]);
    expect(g?.title).toBe("schedule-stalled: 3 scheduled workflow(s) have stopped running");
    expect(g?.origin).toMatch(/^schedule-stalled issue #2196 and alert-ledger row abcdef012345$/);
    expect(g?.markers[0]).toBe("done-when: issue #2196 closed");
    expect(groups.find((x) => x.keys.includes("issue #2197"))?.title).toBe("nightly-red: schedule-heartbeat is red");
  });

  it("the done-when checker holds every alert label's issue to its own green run", () => {
    for (const l of ALERT_LABELS) {
      const issue = { number: 1, title: `x`, state: "closed", labels: [{ name: l }], created_at: "2026-10-03T00:00:00Z", closed_by: { login: "louisianahelpr" } };
      expect(issueMarkerHolds(issue, null).ok, `${l}: a hand close is not evidence`).toBe(false);
      expect(issueMarkerHolds({ ...issue, closed_by: { login: "github-actions[bot]" } }, null).ok, l).toBe(true);
    }
  });
});
