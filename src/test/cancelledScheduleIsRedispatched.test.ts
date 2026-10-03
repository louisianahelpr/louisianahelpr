// @mutate .github/workflows/schedule-heartbeat.yml | node scripts/ci/cancelled-prod-load-runs.mjs --redispatch > /tmp/cancelled.txt | node scripts/ci/cancelled-prod-load-runs.mjs > /tmp/cancelled.txt
// @mutate .github/workflows/schedule-heartbeat.yml |   actions: write | actions: read
// @mutate scripts/ci/cancelled-prod-load-runs.mjs |   if (tried) return { act: false, | if (false) return { act: false,
// @mutate scripts/ci/cancelled-prod-load-runs.mjs |   "vacuity.yml": { full: "true" }, |   "vacuity.yml": {},
// @mutate scripts/ci/cancelled-prod-load-runs.mjs | getUTCDate() > 7 ? | getUTCDate() > 14 ?
/*
 * CLASS GUARD (issue #2196): a scheduled prod-load check that was cancelled
 * before it reported is RE-RUN, once, automatically.
 *
 * Two of #2196's three rows were lost checks:
 *  - write-contract-refresh 37129164563 (Sat 2026-10-03): GitHub delivered
 *    the 09:17 cron at 14:18Z, it waited in `prod-load` behind
 *    press-every-control (09:07-15:20Z), and e2e-real-backend's 11:17 cron,
 *    delivered at 15:07:59Z, took the group's one pending slot: cancelled at
 *    15:08:01Z with no job. Measured lag over 84 scheduled prod-load runs
 *    (09-24..10-03): 127 to 501 minutes, median 274, so the 2-hour spacing of
 *    prodWorkflowSpacing.test.ts cannot keep three runs out of the group.
 *  - expiry-monitor 37082255950: its job sat queued for a runner for 24
 *    minutes and a bulk cancel of the runner queue took it ("The run was
 *    canceled by @louisianahelpr"), as on 2026-10-02 (36947678514).
 * Each time the remedy was a person running `gh workflow run`: seven
 * schedule-stalled issues in ten days, four of them cancelled runs.
 *
 * Now schedule-heartbeat.yml runs scripts/ci/cancelled-prod-load-runs.mjs
 * with --redispatch: a stalled workflow is dispatched once (its own
 * concurrency group, rule 4 of prodWorkflowSpacing.test.ts) and shown as ⏳;
 * only a check whose one re-dispatch was cancelled too stays red.
 *
 * A re-dispatch must run what the SCHEDULE runs, so this reads every prod-load
 * workflow (derived, never a hand list): it must accept workflow_dispatch with
 * no required input, and every place it branches on `'schedule'` must take
 * the same branch for the dispatch, given the dispatch inputs (defaults plus
 * SCHEDULE_INPUTS); a branch that cannot is either fixed by SCHEDULE_INPUTS
 * (vacuity's full sweep) or names a run the schedule would skip (NOT_DUE).
 * Both lists are checked two-way.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
// @ts-expect-error - plain .mjs tool script, no types
import * as scan from "../../scripts/ci/cancelled-prod-load-runs.mjs";

type Run = Record<string, unknown>;
type Plan = { act: boolean; why: string; inputs: Record<string, string> };
const ROOT = resolve(__dirname, "../..");
const prodLoadWorkflows = scan.prodLoadWorkflows as (dir?: string) => string[];
const cancelledScheduledRuns = scan.cancelledScheduledRuns as (runs: Run[], o?: { now?: number; file?: string }) => Run[];
const recoveringScheduledRuns = scan.recoveringScheduledRuns as (runs: Run[], o?: { now?: number; file?: string }) => Run[];
const redispatchPlan = scan.redispatchPlan as (file: string, stalled: Run[], runs: Run[]) => Plan;
const dispatchArgs = scan.dispatchArgs as (repo: string, file: string, inputs?: Record<string, string>) => string[];
const SCHEDULE_INPUTS = scan.SCHEDULE_INPUTS as Record<string, Record<string, string>>;
const NOT_DUE = scan.NOT_DUE as Record<string, (r: Run) => string | null>;

const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");
const files = prodLoadWorkflows(resolve(ROOT, ".github/workflows"));

// #2196's records, as the runs API returned them on 2026-10-03.
const NOW = Date.parse("2026-10-03T16:00:00Z");
const run = (o: Run): Run => ({ event: "schedule", status: "completed", conclusion: "success", html_url: `https://x/runs/${o.id}`, ...o });
const writeContract = [
  run({ id: 37129164563, conclusion: "cancelled", created_at: "2026-10-03T14:18:55Z" }),
  run({ id: 36605000000, created_at: "2026-09-26T13:45:00Z" }),
];
const expiry = [
  run({ id: 37082255950, conclusion: "cancelled", created_at: "2026-10-03T00:29:10Z" }),
  run({ id: 36964255376, event: "workflow_dispatch", created_at: "2026-10-02T04:22:16Z" }),
  run({ id: 36947678514, conclusion: "cancelled", created_at: "2026-10-02T00:46:35Z" }),
  run({ id: 36796693382, created_at: "2026-10-01T00:32:32Z" }),
];

describe("#2196: a cancelled scheduled prod-load check is re-dispatched once", () => {
  it("schedule-heartbeat runs the scan with --redispatch and may dispatch", () => {
    const wf = read(".github/workflows/schedule-heartbeat.yml");
    expect(wf).toContain("node scripts/ci/cancelled-prod-load-runs.mjs --redispatch > /tmp/cancelled.txt");
    const perms = (parse(wf) as { permissions?: Record<string, string> }).permissions ?? {};
    expect(perms.actions, "gh workflow run needs actions: write").toBe("write");
  });

  it("re-dispatches both lost checks of #2196, and only the uncovered one of expiry-monitor", () => {
    const wcStalled = cancelledScheduledRuns(writeContract, { now: NOW, file: "write-contract-refresh.yml" });
    expect(wcStalled.map((r) => r.id)).toEqual([37129164563]);
    expect(redispatchPlan("write-contract-refresh.yml", wcStalled, writeContract)).toMatchObject({ act: true, inputs: {} });
    // 36947678514 (10-02) was covered by the 04:22 dispatch a person ran; 37082255950 was not.
    const exStalled = cancelledScheduledRuns(expiry, { now: NOW, file: "expiry-monitor.yml" });
    expect(exStalled.map((r) => r.id)).toEqual([37082255950]);
    expect(redispatchPlan("expiry-monitor.yml", exStalled, expiry).act).toBe(true);
  });

  it("is recovering while the re-dispatch runs, covered when it finishes, and tried only once", () => {
    const redispatch = (o: Run) => run({ id: 1, event: "workflow_dispatch", created_at: "2026-10-03T16:05:00Z", ...o });
    const inFlight = [redispatch({ status: "in_progress", conclusion: null }), ...writeContract];
    expect(cancelledScheduledRuns(inFlight, { now: NOW })).toHaveLength(0);
    expect(recoveringScheduledRuns(inFlight, { now: NOW })).toHaveLength(1);
    expect(cancelledScheduledRuns([redispatch({ conclusion: "failure" }), ...writeContract], { now: NOW })).toHaveLength(0);
    // Its one re-dispatch was cancelled too: red, and no second try.
    const again = [redispatch({ conclusion: "cancelled" }), ...writeContract];
    const stalled = cancelledScheduledRuns(again, { now: NOW });
    expect(stalled).toHaveLength(1);
    expect(redispatchPlan("write-contract-refresh.yml", stalled, again)).toMatchObject({ act: false });
    expect(redispatchPlan("write-contract-refresh.yml", [], again)).toMatchObject({ act: false });
  });

  it("dispatches with the inputs that reproduce the schedule", () => {
    const v = [run({ id: 9, conclusion: "cancelled", created_at: "2026-09-27T13:03:11Z" })];
    const plan = redispatchPlan("vacuity.yml", v, v);
    expect(plan).toMatchObject({ act: true, inputs: { full: "true" } });
    expect(dispatchArgs("o/r", "vacuity.yml", plan.inputs)).toEqual(["workflow", "run", "vacuity.yml", "--repo", "o/r", "--ref", "main", "-f", "full=true"]);
    expect(dispatchArgs("o/r", "expiry-monitor.yml")).toEqual(["workflow", "run", "expiry-monitor.yml", "--repo", "o/r", "--ref", "main"]);
  });

  it("does not count, or re-run, a run the schedule would have skipped (privacy-journey after day 7)", () => {
    const at = (day: string) => [run({ id: 5, conclusion: "cancelled", created_at: `2026-10-${day}T01:17:00Z` })];
    expect(cancelledScheduledRuns(at("14"), { now: Date.parse("2026-10-15T00:00:00Z"), file: "privacy-journey.yml" })).toHaveLength(0);
    expect(cancelledScheduledRuns(at("07"), { now: Date.parse("2026-10-08T00:00:00Z"), file: "privacy-journey.yml" })).toHaveLength(1);
    expect(cancelledScheduledRuns(at("14"), { now: Date.parse("2026-10-15T00:00:00Z"), file: "e2e-journeys.yml" })).toHaveLength(1);
  });
});

type Input = { required?: boolean; default?: unknown };
type Step = { if?: string; run?: string };
type Job = { if?: string; steps?: Step[] };
type Workflow = { on?: Record<string, unknown>; jobs?: Record<string, Job> };

const truthy = (v: unknown) => !(v === undefined || v === null || v === false || v === "" || v === "false");

/** Every `if:` and (comment-free) `run:` text of a workflow, parsed, so YAML comments never count. */
function branchTexts(wf: Workflow): string[] {
  const out: string[] = [];
  for (const job of Object.values(wf.jobs ?? {})) {
    if (job?.if) out.push(String(job.if));
    for (const s of job?.steps ?? []) {
      if (s.if) out.push(String(s.if));
      if (s.run) out.push(...String(s.run).split("\n").filter((l) => !/^\s*#/.test(l)));
    }
  }
  return out;
}

/** Does a "schedule or dispatch" condition hold for the dispatch? Checks each `inputs.X` test against the dispatch value. */
function dispatchSideHolds(text: string, value: (k: string) => unknown): string[] {
  const bad: string[] = [];
  for (const m of text.matchAll(/(!?)\s*inputs\.(\w+)\s*(==|!=)?\s*('[^']*'|true|false)?/g)) {
    const [, not, k, op, rhs] = m;
    const v = value(k);
    let ok: boolean;
    if (op) {
      const want = String(rhs ?? "").replace(/^'|'$/g, "");
      ok = op === "==" ? String(v ?? "") === want : String(v ?? "") !== want;
    } else ok = not ? !truthy(v) : truthy(v);
    if (!ok) bad.push(`inputs.${k} (dispatch value ${JSON.stringify(v)}) fails "${m[0].trim()}"`);
  }
  return bad;
}

describe("a re-dispatch runs what the schedule runs, for every prod-load workflow", () => {
  const scheduleOnly = new Map<string, string[]>();
  const problems: string[] = [];
  let branches = 0;
  for (const f of files) {
    const wf = parse(read(`.github/workflows/${f}`)) as Workflow;
    const dispatch = (wf.on ?? {})["workflow_dispatch"] as { inputs?: Record<string, Input> } | null | undefined;
    if (!("workflow_dispatch" in (wf.on ?? {}))) {
      problems.push(`${f}: no workflow_dispatch, so a lost scheduled run cannot be re-dispatched`);
      continue;
    }
    const inputs = dispatch?.inputs ?? {};
    for (const [k, i] of Object.entries(inputs)) {
      if (i?.required && i.default === undefined) problems.push(`${f}: dispatch input ${k} is required with no default`);
    }
    const value = (k: string) => SCHEDULE_INPUTS[f]?.[k] ?? inputs[k]?.default;
    for (const t of branchTexts(wf)) {
      if (!/(['"])schedule\1/.test(t)) continue;
      branches++;
      if (/workflow_dispatch/.test(t)) {
        for (const b of dispatchSideHolds(t, value)) problems.push(`${f}: a dispatch would skip a scheduled branch: ${b}`);
      } else {
        scheduleOnly.set(f, [...(scheduleOnly.get(f) ?? []), t.trim()]);
      }
    }
  }

  it("reads the real prod-load inventory (floor)", () => {
    expect(files.length).toBeGreaterThan(15);
    expect(branches).toBeGreaterThan(15);
    expect([...scheduleOnly.keys()].sort()).toEqual(expect.arrayContaining(["privacy-journey.yml", "vacuity.yml"]));
  });

  it("every prod-load workflow can be dispatched, and a dispatch takes every branch the schedule takes", () => {
    expect(problems.join("\n")).toBe("");
  });

  it("a schedule-only branch is reproduced by SCHEDULE_INPUTS or names a run the schedule skips (NOT_DUE)", () => {
    const unhandled = [...scheduleOnly].filter(([f]) => !SCHEDULE_INPUTS[f] && !NOT_DUE[f]).map(([f, ts]) => `${f}: ${ts.join(" | ")}`);
    expect(unhandled, "add the inputs that make a dispatch take this branch to SCHEDULE_INPUTS").toEqual([]);
    // SCHEDULE_INPUTS must name an input each schedule-only line actually reads.
    for (const [f, ins] of Object.entries(SCHEDULE_INPUTS)) {
      for (const t of scheduleOnly.get(f) ?? []) expect(Object.keys(ins).some((k) => t.includes(`inputs.${k}`)), `${f}: ${t}`).toBe(true);
    }
  });

  it("SCHEDULE_INPUTS and NOT_DUE name only prod-load workflows that really branch on schedule (two-way)", () => {
    const staleInputs = Object.keys(SCHEDULE_INPUTS).filter((f) => !scheduleOnly.has(f));
    const staleNotDue = Object.keys(NOT_DUE).filter((f) => !scheduleOnly.has(f));
    expect(staleInputs).toEqual([]);
    expect(staleNotDue).toEqual([]);
    for (const [f, ins] of Object.entries(SCHEDULE_INPUTS)) {
      const declared = ((parse(read(`.github/workflows/${f}`)) as Workflow).on?.["workflow_dispatch"] as { inputs?: Record<string, Input> })?.inputs ?? {};
      for (const k of Object.keys(ins)) expect(Object.keys(declared), `${f} has no dispatch input ${k}`).toContain(k);
    }
  });

  it("NOT_DUE agrees with privacy-journey's own gate, day for day", () => {
    const gate = (scheduleOnly.get("privacy-journey.yml") ?? []).find((t) => /-gt\s+\d+/.test(t)) ?? "";
    const last = Number(/-gt\s+(\d+)/.exec(gate)?.[1]);
    expect(last).toBeGreaterThan(0);
    for (let d = 1; d <= 28; d++) {
      const r = { created_at: `2026-10-${String(d).padStart(2, "0")}T01:17:00Z` };
      expect(Boolean(NOT_DUE["privacy-journey.yml"](r)), `day ${d}`).toBe(d > last);
    }
  });
});
