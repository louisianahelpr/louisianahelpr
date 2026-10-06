/**
 * A SCHEDULED prod-load RUN THAT WAS CANCELLED IS A RED (docs/OPEN.md Q293).
 *
 * Every prod-hitting workflow used to share the workflow-level concurrency group
 * `prod-load` (src/test/prodWorkflowSpacing.test.ts); since Q1161 they wait in a
 * FIFO queue job instead (scripts/ci/wait-prod-load.mjs), which cannot cancel a
 * run. Under the old group GitHub kept ONE pending run: a third run entering it
 * cancelled the one already waiting, at WORKFLOW level, so not one job ran, not
 * even the `notify` job that files the nightly-red issue. The run's only trace is conclusion `cancelled` in the
 * run list. For the monthly privacy journey that is a missed month, and
 * schedule-heartbeat's staleness rule cannot see it (the cancelled run still
 * counts as "a scheduled run", created on time). A person cancelling a queued
 * scheduled run (a bulk "clear the runner queue") loses the check the same
 * way: expiry-monitor on 2026-10-02 and 2026-10-03, both at 00:53Z.
 *
 * For EVERY workflow with a `schedule:` trigger (derived from the files, never
 * a hand list; Q1162 widened this from the prod-load workflows, so a hand-
 * cancelled a11y-webkit / lighthouse / ui-sweep run is seen too), list its
 * recent schedule-triggered runs and judge every one whose conclusion is
 * `cancelled` inside WINDOW_DAYS (coverOf):
 *   covered     a later scheduled or FULL dispatched run completed (green or
 *               red: a red one files its own nightly-red issue);
 *   recovering  such a run is still in flight: ⏳ row, not counted, judged
 *               again by the next heartbeat;
 *   neither     STALLED.
 * A workflow that fires more often than daily (uptime, prod-errors, main-batch,
 * prod-deploy...) covers itself: its next run re-tests what a cancelled one
 * skipped. A cancelled run of one is judged only once it is SUB_DAILY_GRACE_MS
 * old, so the heartbeat never reads the newest run of a 10-minute cron as lost
 * in the minutes before the next one starts.
 * A main-batch dispatch of e2e-real-backend is not a full run (it skips every
 * scheduled job) and covers nothing; a run the schedule would have skipped
 * anyway (NOT_DUE) is not a loss.
 *
 * With --redispatch (schedule-heartbeat.yml) a stalled workflow is dispatched
 * ONCE, with the inputs that make a dispatch run what the schedule runs
 * (SCHEDULE_INPUTS), and its rows are ⏳ instead of red: the lost check runs,
 * in its own concurrency group (prodWorkflowSpacing.test.ts rule 4), and
 * reports through its own notify job. Before this the remedy was a person
 * reading issue #2196 and typing `gh workflow run`: seven schedule-stalled
 * issues in ten days (#1695..#2196), four of them for cancelled runs. A
 * stalled run whose re-dispatch was itself cancelled is not tried again
 * (redispatchPlan): it stays red, with its cause (cancelCause), and the
 * heartbeat opens the `schedule-stalled` issue and turns red.
 *
 *   node scripts/ci/cancelled-prod-load-runs.mjs [--redispatch [--dry-run]]
 *   (needs gh + GH_TOKEN, REPO; --redispatch needs actions: write)
 *
 * Only the prod-load workflows are re-dispatched automatically (their dispatch
 * is known to run what the schedule runs: cancelledScheduleIsRedispatched.test.ts).
 * A cancelled run of any other scheduled workflow is REPORTED red, with the
 * reason, until a later run covers it (a person's `gh workflow run` counts).
 *
 * Prints one markdown table row per cancelled run, then `cancelled=<n>` last
 * (stalled runs only). Exits non-zero (code two) when a workflow's runs could
 * not be read: not checked is not clean.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { classifyJobs } from "./run-verdict.mjs";

/** Eight days: a weekly cadence plus one, so every cancelled run is reported by at least one daily heartbeat and stays red for a week. */
export const WINDOW_DAYS = 8;

/** A cancelled run of a more-than-daily workflow is judged once it is this old (its own next run usually covers it). */
export const SUB_DAILY_GRACE_MS = 24 * 3_600_000;

/** The workflow-level `concurrency.group` of a workflow file, or null. Top-level only (a job's own group is not the account lock). */
export function workflowConcurrencyGroup(src) {
  const m = /^concurrency:\s*\n((?:[ \t]+.*\n|[ \t]*\n)*)/m.exec(src.endsWith("\n") ? src : `${src}\n`);
  if (!m) {
    const inline = /^concurrency:\s*(\S.*)$/m.exec(src);
    return inline ? inline[1].trim().replace(/^["']|["']$/g, "") : null;
  }
  const g = /^[ \t]+group:\s*(.+)$/m.exec(m[1]);
  return g ? g[1].trim().replace(/^["']|["']$/g, "") : null;
}

/** Can this group be `prod-load`? A literal, or an expression that yields 'prod-load' on some event. */
export function isProdLoadGroup(group) {
  if (!group) return false;
  return group === "prod-load" || /'prod-load'/.test(group);
}

/** Does a scheduled run of this workflow wait in the prod-load FIFO queue (Q1161: scripts/ci/wait-prod-load.mjs)? */
export function runsProdLoadQueue(src) {
  return src.split("\n").some((l) => !/^\s*#/.test(l) && l.includes("node scripts/ci/wait-prod-load.mjs"));
}

/** Every workflow file whose scheduled runs are ordered by the prod-load queue (Q1161), or still share the legacy prod-load group. */
export function prodLoadWorkflows(dir = resolve(process.cwd(), ".github/workflows")) {
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .filter((f) => {
      const src = readFileSync(resolve(dir, f), "utf8");
      return /^\s*schedule:\s*$/m.test(src) && (runsProdLoadQueue(src) || isProdLoadGroup(workflowConcurrencyGroup(src)));
    })
    .sort();
}

const hasSchedule = (src) => /^\s*schedule:\s*$/m.test(src);

/** Every workflow file with a `schedule:` trigger (Q1162). */
export function scheduledWorkflows(dir = resolve(process.cwd(), ".github/workflows")) {
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .filter((f) => hasSchedule(readFileSync(resolve(dir, f), "utf8")))
    .sort();
}

/** What the scan reads: EVERY scheduled workflow (Q1162), and which of them share the prod-load group (only those are re-dispatched). */
export function scanTargets(dir = resolve(process.cwd(), ".github/workflows")) {
  return { files: scheduledWorkflows(dir), prodLoad: new Set(prodLoadWorkflows(dir)) };
}

/** The cron expressions of a workflow file, comments ignored. */
export function cronsOf(src) {
  return [...src.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n").matchAll(/-\s*cron:\s*["']([^"']+)["']/g)].map((m) => m[1].trim());
}

/** Does any cron fire more than once a day? A plain integer minute AND hour fires at most daily. */
export function firesMoreThanDaily(src) {
  return cronsOf(src).some((c) => {
    const [min, hour] = c.split(/\s+/);
    return !/^\d+$/.test(min) || !/^\d+$/.test(hour);
  });
}

/** Events whose run re-tests what a cancelled scheduled run skipped (and reports its own red). */
const COVERING_EVENTS = new Set(["schedule", "workflow_dispatch"]);
const IN_FLIGHT = new Set(["requested", "queued", "pending", "waiting", "in_progress"]);

/**
 * Does this run re-test the WHOLE scheduled check? A scheduled or dispatched
 * run does, except a main-batch dispatch (scripts/ci/main-batch.mjs; run-name
 * "<workflow> (main batch <sha>)"): it skips every scheduled job of
 * e2e-real-backend. Those land every 20 minutes, and until 2026-10-03 the next
 * one "covered" any cancelled scheduled e2e-real-backend run.
 */
export function rerunsTheSchedule(o) {
  return COVERING_EVENTS.has(o.event) && !String(o.display_title ?? "").includes("(main batch ");
}

/**
 * Where a cancelled scheduled run `r` stands against the workflow's other runs:
 * "covered" (a LATER full run completed, not cancelled or skipped), "recovering"
 * (a later full run is still in flight), or null (stalled). A daily monitor's
 * lost night stops holding the heartbeat red once the next night ran
 * (expiry-monitor stayed "stalled" 6 days after 5 green nights, 2026-09-30).
 */
export function coverOf(r, runs) {
  const later = runs.filter((o) => rerunsTheSchedule(o) && Date.parse(o.created_at) > Date.parse(r.created_at));
  if (later.some((o) => o.status === "completed" && o.conclusion !== "cancelled" && o.conclusion !== "skipped")) return "covered";
  if (later.some((o) => IN_FLIGHT.has(o.status))) return "recovering";
  return null;
}

/**
 * A scheduled run the workflow itself would have skipped, by file: why, or
 * null. privacy-journey.yml's cron fires every Wednesday and its `gate` job
 * lets a SCHEDULED run through only on days 1-7 of the month, so a later
 * Wednesday's run was never due and losing it loses nothing (the heartbeat's
 * marker rule checks the month itself).
 */
// @two-way src/test/cancelledScheduleIsRedispatched.test.ts:const staleNotDue =
export const NOT_DUE = {
  "privacy-journey.yml": (r) => (new Date(r.created_at).getUTCDate() > 7 ? "not due: its gate runs the journey on days 1-7 only" : null),
};

/**
 * Dispatch inputs that make a dispatch run what the SCHEDULE runs, by file. A
 * bare dispatch of vacuity.yml runs only the changed set; its schedule runs
 * every mutation (`vacuity:all`), and so does `full: true`.
 */
// @two-way src/test/cancelledScheduleIsRedispatched.test.ts:const staleInputs =
export const SCHEDULE_INPUTS = {
  "vacuity.yml": { full: "true" },
};

const cancelledInWindow = (runs, now, windowDays, file, graceMs = 0) =>
  runs.filter((r) => r.event === "schedule" && r.status === "completed" && r.conclusion === "cancelled" && Date.parse(r.created_at) >= now - windowDays * 86_400_000 && Date.parse(r.created_at) <= now - graceMs && !NOT_DUE[file]?.(r));

/** STALLED: scheduled runs (GitHub API shape) of `file` cancelled inside the window that nothing re-tested and nothing is re-testing. */
export function cancelledScheduledRuns(runs, { now = Date.now(), windowDays = WINDOW_DAYS, file = "", graceMs = 0 } = {}) {
  return cancelledInWindow(runs, now, windowDays, file, graceMs).filter((r) => coverOf(r, runs) === null);
}

/** RECOVERING: scheduled runs cancelled inside the window whose re-test is in flight. */
export function recoveringScheduledRuns(runs, { now = Date.now(), windowDays = WINDOW_DAYS, file = "", graceMs = 0 } = {}) {
  return cancelledInWindow(runs, now, windowDays, file, graceMs).filter((r) => coverOf(r, runs) === "recovering");
}

/**
 * Whether to re-dispatch `file` for its STALLED runs: once. One dispatch
 * re-tests them all. A full dispatch created after the newest stalled run can
 * only have been cancelled itself (a completed one would cover, an in-flight
 * one would make it recovering): that was the one try, and the run stays red.
 */
export function redispatchPlan(file, stalled, runs, { prodLoad = true } = {}) {
  if (!stalled.length) return { act: false, why: "nothing stalled", inputs: {} };
  if (!prodLoad) return { act: false, why: "outside prod-load a dispatch is not known to run what the schedule runs, so it is reported, not re-dispatched: run it by hand", inputs: {} };
  const newest = stalled.map((r) => Date.parse(r.created_at)).reduce((a, b) => Math.max(a, b));
  const tried = runs.find((o) => o.event === "workflow_dispatch" && rerunsTheSchedule(o) && Date.parse(o.created_at) > newest);
  if (tried) return { act: false, why: `its one re-dispatch (${tried.html_url ?? tried.id}) was cancelled too`, inputs: {} };
  return { act: true, why: `${stalled.length} cancelled scheduled run(s) never reported`, inputs: SCHEDULE_INPUTS[file] ?? {} };
}

/** The `gh` argv that re-dispatches `file` on main with `inputs`. */
export function dispatchArgs(repo, file, inputs = {}) {
  return ["workflow", "run", file, "--repo", repo, "--ref", "main", ...Object.entries(inputs).flatMap(([k, v]) => ["-f", `${k}=${v}`])];
}

/**
 * Why a run was cancelled, in words, from its jobs and the annotations of its
 * first cancelled job. No job at all: it was cancelled while waiting at
 * WORKFLOW level (the prod-load pending slot, or by hand before it started).
 * "The run was canceled by @x": a person (expiry-monitor 37082255950, a bulk
 * cancel of the runner queue on 2026-10-03).
 */
export function cancelCause(jobs, annotations = [], { prodLoad = true } = {}) {
  if (!jobs?.length) return prodLoad ? "no job ever started: it lost the prod-load group's one pending slot (or was cancelled by hand while waiting)" : "no job ever started: it was cancelled by hand while waiting (or by its own concurrency group)";
  const by = annotations.map((a) => /The run was canceled by @([\w-]+)/.exec(String(a?.message ?? ""))?.[1]).find(Boolean);
  if (by) return `cancelled by hand (@${by}) with ${jobs.length} job(s) created`;
  if (annotations.some((a) => /higher priority waiting request/.test(String(a?.message ?? "")))) return "a job lost its concurrency group's pending slot";
  return `cancelled with ${jobs.length} job(s) created`;
}

/**
 * The display names of a workflow's REPORTING jobs: the jobs whose steps use
 * ./.github/actions/nightly-issue-sync (a job's `name:`, else its key).
 */
export function reporterJobNames(src) {
  const text = String(src);
  const jobsAt = /^jobs:\s*$/m.exec(text);
  if (!jobsAt) return new Set();
  const body = text.slice(jobsAt.index + jobsAt[0].length);
  const out = new Set();
  const heads = [...body.matchAll(/^ {2}([A-Za-z0-9_-]+):\s*$/gm)];
  heads.forEach((h, i) => {
    const block = body.slice(h.index, i + 1 < heads.length ? heads[i + 1].index : body.length);
    const code = block.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    if (!/uses:\s*["']?\.\/\.github\/actions\/nightly-issue-sync["']?\s*$/m.test(code)) return;
    const name = /^ {4}name:\s*(.+?)\s*$/m.exec(code)?.[1]?.replace(/^["']|["']$/g, "");
    out.add(name ?? h[1]);
  });
  return out;
}

/**
 * Did a cancelled scheduled run REPORT ITSELF? A job killed by its own
 * timeout-minutes gives the RUN conclusion `cancelled` (a11y-webkit-prod run
 * 37355527038, 2026-10-05: "The job has exceeded the maximum execution time
 * of 1h0m0s"), yet its notify job still ran and filed the red on the
 * workflow's own nightly-red issue (#2375). That run was not lost; calling it
 * "cancelled, nothing reported" opened a second alert for one red
 * (schedule-stalled #2464 + nightly-red: schedule-heartbeat #2465).
 * True only when run-verdict's classifyJobs calls the jobs a FAILURE (a
 * timeout or a failed step, never a bare cancel) AND a reporting job of the
 * workflow (reporterJobNames) concluded success. A run cancelled by hand or
 * by its group (notify skipped on `!cancelled()`) stays a loss.
 */
export function reportedItsOwnRed(jobs, annotations, reporters) {
  if (!jobs?.length || !reporters?.size) return false;
  if (!jobs.some((j) => reporters.has(j.name) && j.conclusion === "success")) return false;
  const checks = jobs.filter((j) => !reporters.has(j.name));
  // Fail-closed the heartbeat's way: classifyJobs reads an unread annotation as
  // a failure (right for filing a red), which here would excuse the run.
  if (checks.some((j) => j.conclusion === "cancelled" && !Array.isArray(annotations?.[j.id]))) return false;
  return classifyJobs(checks, annotations).failed.length > 0;
}

const ghJson = (args) => JSON.parse(execFileSync("gh", args, { encoding: "utf8", maxBuffer: 1 << 26 }) || "null");

/** gh api over every page of a runs listing, as one array. */
function ghRuns(path) {
  const out = execFileSync("gh", ["api", "--paginate", path, "--jq", ".workflow_runs[]"], { encoding: "utf8", maxBuffer: 1 << 26 });
  return out.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

/**
 * A workflow's scheduled runs on main, plus, when one of them was cancelled and
 * no later scheduled run accounts for it, every dispatched run since. Separate
 * reads: e2e-real-backend's 50 newest runs on main spanned 34 hours on
 * 2026-10-03 (39 of them main-batch dispatches), so one mixed page hid six of
 * the window's eight days.
 */
export function workflowRuns(repo, file, { now = Date.now(), windowDays = WINDOW_DAYS, runs = ghRuns, graceMs = 0 } = {}) {
  const sched = runs(`repos/${repo}/actions/workflows/${file}/runs?branch=main&event=schedule&per_page=100&created=${encodeURIComponent(`>=${new Date(now - windowDays * 86_400_000).toISOString()}`)}`);
  const open = cancelledInWindow(sched, now, windowDays, file, graceMs).filter((r) => coverOf(r, sched) === null);
  if (!open.length) return sched;
  const since = open.map((r) => r.created_at).sort()[0];
  return [...sched, ...runs(`repos/${repo}/actions/workflows/${file}/runs?branch=main&event=workflow_dispatch&per_page=100&created=${encodeURIComponent(`>=${since}`)}`)];
}

/** The run's jobs and every cancelled job's annotations (an unread one is left out). Never throws. */
function runFacts(repo, r) {
  try {
    const jobs = ghJson(["api", `repos/${repo}/actions/runs/${r.id}/jobs?per_page=50`, "--jq", ".jobs"]) ?? [];
    const annotations = {};
    for (const j of jobs.filter((x) => x.conclusion === "cancelled")) {
      try { annotations[j.id] = ghJson(["api", `repos/${repo}/check-runs/${j.id}/annotations`]) ?? []; }
      catch { /* left unread: reportedItsOwnRed then refuses to excuse the run */ }
    }
    return { jobs, annotations, error: null };
  } catch (e) {
    return { jobs: null, annotations: {}, error: String(e.message).split("\n")[0] };
  }
}

function causeOf(facts, prodLoad) {
  if (facts.error) return `cause unread (${facts.error})`;
  const first = facts.jobs.find((j) => j.conclusion === "cancelled");
  return cancelCause(facts.jobs, (first && facts.annotations[first.id]) || [], { prodLoad });
}

function main() {
  const repo = process.env.REPO;
  if (!repo) { console.error("REPO is not set"); process.exit(2); }
  const redispatch = process.argv.includes("--redispatch");
  const dryRun = process.argv.includes("--dry-run");
  const { files, prodLoad } = scanTargets();
  if (prodLoad.size < 5 || files.length < 20) { console.error(`found only ${prodLoad.size} prod-load / ${files.length} scheduled workflows — the scan is broken`); process.exit(2); }
  let n = 0;
  let unread = 0;
  for (const f of files) {
    let runs;
    const graceMs = firesMoreThanDaily(readFileSync(resolve(process.cwd(), ".github/workflows", f), "utf8")) ? SUB_DAILY_GRACE_MS : 0;
    try {
      runs = workflowRuns(repo, f, { graceMs });
    } catch (e) {
      unread++;
      console.error(`::error::${f}: could not list scheduled runs (${String(e.message).split("\n")[0]})`);
      continue;
    }
    for (const r of recoveringScheduledRuns(runs, { file: f, graceMs })) {
      const next = runs.filter((o) => rerunsTheSchedule(o) && Date.parse(o.created_at) > Date.parse(r.created_at) && IN_FLIGHT.has(o.status))[0];
      console.log(`| \`${f}\` | cancelled, re-run in flight | ${r.created_at} | ⏳ ${r.html_url} is being re-tested by ${next?.html_url ?? "a later run"} |`);
    }
    const cancelledRuns = cancelledScheduledRuns(runs, { file: f, graceMs });
    if (!cancelledRuns.length) continue;
    // A run whose own job timed out or failed, and whose notify job filed that
    // red, reported itself (reportedItsOwnRed): its red lives on the
    // workflow's nightly-red issue, not here.
    const reporters = reporterJobNames(readFileSync(resolve(process.cwd(), ".github/workflows", f), "utf8"));
    const facts = new Map(cancelledRuns.map((r) => [r.id, runFacts(repo, r)]));
    const stalled = [];
    for (const r of cancelledRuns) {
      const fx = facts.get(r.id);
      if (!fx.error && reportedItsOwnRed(fx.jobs, fx.annotations, reporters)) {
        console.log(`| \`${f}\` | timed out or failed, reported | ${r.created_at} | ✅ a job timed out or failed (run conclusion \`cancelled\`), and its notify job filed the red on the workflow's own nightly-red issue: ${r.html_url} |`);
        continue;
      }
      stalled.push(r);
    }
    if (!stalled.length) continue;
    const plan = redispatch ? redispatchPlan(f, stalled, runs, { prodLoad: prodLoad.has(f) }) : { act: false, why: "re-dispatch not asked for", inputs: {} };
    let sent = null;
    if (plan.act) {
      const args = dispatchArgs(repo, f, plan.inputs);
      try {
        if (!dryRun) execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
        sent = `${dryRun ? "would re-dispatch" : "re-dispatched"} now (gh ${args.join(" ")})`;
      } catch (e) {
        plan.why = `re-dispatch FAILED: ${String(e.stderr || e.message).split("\n")[0]}`;
      }
    }
    for (const r of stalled) {
      const cause = causeOf(facts.get(r.id), prodLoad.has(f));
      if (sent) {
        console.log(`| \`${f}\` | cancelled, re-dispatched | ${r.created_at} | ⏳ ${cause}; ${sent}: ${r.html_url} |`);
        console.error(`::warning::${f}: scheduled run ${r.id} (${r.created_at}) was cancelled (${cause}); ${sent}.`);
        continue;
      }
      n++;
      console.log(`| \`${f}\` | cancelled | ${r.created_at} | 🔴 scheduled run cancelled (${cause}), nothing reported and no re-run covered it (${plan.why}): ${r.html_url} |`);
      console.error(`::error::${f}: scheduled run ${r.id} (${r.created_at}) was cancelled (${cause}), and a cancelled run files no nightly-red issue (Q293, Q821); ${plan.why}.`);
    }
  }
  console.log(`cancelled=${n}`);
  if (unread) process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
