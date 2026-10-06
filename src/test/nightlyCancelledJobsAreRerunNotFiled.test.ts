/*
 * CLASS GUARD (owner, 2026-10-05): a run whose jobs were only CANCELLED never
 * opens or keeps a nightly-red issue; it is re-run once instead.
 *
 * Found 2026-10-05: five of nine open `nightly-red` issues pointed at runs whose
 * jobs were cancelled, not failed. db-drift-detect run 37373724889 attempt 1:
 * "Wait for the prod-load queue" concluded `cancelled` (annotation "The job was
 * not acquired by Runner of type hosted even after multiple attempts"), the
 * notify job still ran (only a JOB was cancelled, so `!cancelled()` held) and
 * filed #2384 with `status: failure`. nightlyCancelledRunStaysSilent covers a
 * cancelled RUN; nothing covered a cancelled JOB inside a running one.
 *
 * THE RULE, tested by running the action's own shell with a fake `gh`:
 *   - status failure + only cancelled jobs on attempt 1: no `gh issue create`,
 *     no "Still red" comment, no close; dispatches nightly-red-rerun.yml with
 *     the run id; verdict output `cancelled`; the step summary says so;
 *   - a real failure, a TIMEOUT (GitHub reports a job killed by timeout-minutes
 *     as `cancelled`: a11y-webkit-prod run 37355527038, annotation "The job has
 *     exceeded the maximum execution time of 1h0m0s"), a cancel on attempt 2,
 *     an unreadable run, or a failed dispatch: files exactly as before.
 *
 * INVENTORY: every workflow job that uses ./.github/actions/nightly-issue-sync
 * (read from the files) gets the same treatment, because the logic lives in the
 * action; each such job's token must be able to read the run's jobs and
 * annotations and dispatch the re-run (actions: write, checks: read), or the
 * verdict read fails and the cancel is filed as a red (fail-closed, but the fix
 * would be dead for that workflow).
 */

// @mutate .github/actions/nightly-issue-sync/action.yml |           if [ "$V" = "cancelled" ] && [ "$ATTEMPT" = "1" ] && [ -n "$RUN_ID" ]; then |           if false; then
// @mutate .github/actions/nightly-issue-sync/action.yml |           elif [ "$V" = "cancelled" ]; then |           elif false; then
// @mutate scripts/ci/run-verdict.mjs | if (notes.some((a) => TIMEOUT_ANNOTATION.test(a?.message ?? ""))) { | if (false) {
// @mutate scripts/ci/run-verdict.mjs | if (!Array.isArray(notes)) { | if (false) {
// @mutate scripts/ci/run-verdict.mjs | if (!cancelled.length) return | if (false) return
// @mutate .github/workflows/nightly-red-rerun.yml |           if [ "$ATTEMPT" != "1" ]; then |           if false; then
// @mutate .github/workflows/db-drift-detect.yml |       actions: write\n      checks: read\n | \n

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
// @ts-expect-error — plain .mjs script, no declaration file
import { classifyJobs, runIdOf } from "../../scripts/ci/run-verdict.mjs";

const ROOT = join(__dirname, "..", "..");
const ACTION_DIR = join(ROOT, ".github", "actions", "nightly-issue-sync");
const WORKFLOWS = join(ROOT, ".github", "workflows");
const REPO = "o/r";
const RUN = "4242";

type Job = { id: number; name: string; status: string; conclusion: string | null; steps?: { conclusion: string }[] };

// Shapes measured on the live jobs + annotations APIs, 2026-10-05.
const NOT_ACQUIRED = [{ message: "The job was not acquired by Runner of type hosted even after multiple attempts" }];
const TIMED_OUT = [{ message: "The job has exceeded the maximum execution time of 1h0m0s" }, { message: "The operation was canceled." }];
const SELF: Job = { id: 3, name: "Report nightly result", status: "in_progress", conclusion: null };
const DRIFT_ATTEMPT_1: Job[] = [
  { id: 1, name: "Wait for the prod-load queue (first in, first served)", status: "completed", conclusion: "cancelled", steps: [] },
  { id: 2, name: "Diff local vs prod migration history", status: "completed", conclusion: "skipped", steps: [] },
  SELF,
];
const A11Y_ATTEMPT_1: Job[] = [
  { id: 1, name: "Sweep prod (chromium + webkit)", status: "completed", conclusion: "cancelled", steps: [{ conclusion: "success" }, { conclusion: "failure" }, { conclusion: "cancelled" }] },
  { id: 2, name: "WebKit-only violations", status: "completed", conclusion: "cancelled", steps: [] },
  SELF,
];

describe("run-verdict: which reds were only cancelled jobs", () => {
  it("reads the run id from every run-url shape the callers pass", () => {
    expect(runIdOf("https://github.com/o/r/actions/runs/37373724889")).toBe("37373724889");
    expect(runIdOf("https://github.com/o/r/actions/runs/37373724889/attempts/2")).toBe("37373724889");
    expect(runIdOf("37373724889")).toBe("37373724889");
    expect(runIdOf("https://github.com/o/r/pull/7")).toBeNull();
  });

  it("an infrastructure cancel (runner never acquired) is `cancelled`; skipped and still-running jobs are ignored", () => {
    expect(classifyJobs(DRIFT_ATTEMPT_1, { 1: NOT_ACQUIRED }).verdict).toBe("cancelled");
  });

  it("a timeout reported as `cancelled` is a failure", () => {
    const pureTimeout: Job = { id: 1, name: "Sweep", status: "completed", conclusion: "cancelled", steps: [{ conclusion: "success" }, { conclusion: "cancelled" }] };
    expect(classifyJobs([pureTimeout, SELF], { 1: TIMED_OUT }).verdict).toBe("failure");
    expect(classifyJobs([pureTimeout, SELF], { 1: NOT_ACQUIRED }).verdict).toBe("cancelled");
    expect(classifyJobs([A11Y_ATTEMPT_1[0]], { 1: TIMED_OUT }).verdict).toBe("failure");
    expect(classifyJobs(A11Y_ATTEMPT_1, { 1: TIMED_OUT, 2: NOT_ACQUIRED }).verdict).toBe("failure");
  });

  it("a cancel after a failed step, a failed job, unread annotations, or no cancel at all is a failure", () => {
    expect(classifyJobs([{ ...A11Y_ATTEMPT_1[0] }], { 1: [] }).verdict).toBe("failure");
    expect(classifyJobs([...DRIFT_ATTEMPT_1, { id: 9, name: "x", status: "completed", conclusion: "failure" }], { 1: NOT_ACQUIRED }).verdict).toBe("failure");
    expect(classifyJobs(DRIFT_ATTEMPT_1, {}).verdict).toBe("failure");
    expect(classifyJobs([DRIFT_ATTEMPT_1[1], SELF], {}).verdict).toBe("failure");
  });
});

// ---- The action's own shell, run against a fake `gh` -------------------------

const action = parse(readFileSync(join(ACTION_DIR, "action.yml"), "utf8")) as { runs: { steps: { name?: string; run?: string }[] } };
const SCRIPT = action.runs.steps.find((s) => s.name === "Sync the issue for this workflow")?.run ?? "";

const FAKE_GH = `#!/usr/bin/env bash
printf '%s\\n' "$(printf '%s' "$*" | tr '\\n' ' ')" >> "$FAKE_DIR/log"
case "$1 $2" in
  "issue list") printf '%s\\n' "\${FAKE_EXISTING:-}" | sed '/^$/d' ;;
  "issue view") date -u +%Y-%m-%dT%H:%M:%SZ ;;
  "workflow run") exit "\${FAKE_DISPATCH_RC:-0}" ;;
  api*) f="$FAKE_DIR/api/$(printf '%s' "$2" | tr -c 'A-Za-z0-9' '_')"; [ -f "$f" ] && cat "$f" || exit 1 ;;
esac
exit 0
`;

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nightly-sync-"));
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "gh"), FAKE_GH);
  chmodSync(join(dir, "bin", "gh"), 0o755);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

type Case = { status: "success" | "failure"; attempt?: number; jobs?: Job[]; annotations?: Record<number, unknown>; existing?: string; dispatchRc?: number };

function runAction(c: Case): { log: string; summary: string; output: string } {
  const d = mkdtempSync(join(dir, "case-"));
  mkdirSync(join(d, "api"));
  const key = (p: string) => join(d, "api", p.replace(/[^A-Za-z0-9]/g, "_"));
  if (c.jobs) {
    const attempt = c.attempt ?? 1;
    writeFileSync(key(`repos/${REPO}/actions/runs/${RUN}`), JSON.stringify({ id: Number(RUN), run_attempt: attempt }));
    writeFileSync(key(`repos/${REPO}/actions/runs/${RUN}/attempts/${attempt}/jobs?per_page=100`), JSON.stringify({ jobs: c.jobs }));
    for (const [id, notes] of Object.entries(c.annotations ?? {})) writeFileSync(key(`repos/${REPO}/check-runs/${id}/annotations`), JSON.stringify(notes));
  }
  writeFileSync(join(d, "log"), "");
  writeFileSync(join(d, "summary"), "");
  writeFileSync(join(d, "output"), "");
  execFileSync("bash", ["-c", SCRIPT], {
    env: {
      PATH: `${join(dir, "bin")}:${process.env.PATH}`,
      HOME: process.env.HOME ?? d,
      FAKE_DIR: d,
      FAKE_EXISTING: c.existing ?? "",
      FAKE_DISPATCH_RC: String(c.dispatchRc ?? 0),
      GH_TOKEN: "x",
      WORKFLOW_NAME: "db-drift-detect",
      STATUS: c.status,
      LABEL: "nightly-red",
      LABEL_DESC: "d",
      BODY_EXTRA: "",
      RUN_URL: `https://github.com/${REPO}/actions/runs/${RUN}`,
      REPO,
      ACTION_PATH: ACTION_DIR,
      GITHUB_STEP_SUMMARY: join(d, "summary"),
      GITHUB_OUTPUT: join(d, "output"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const read = (f: string) => readFileSync(join(d, f), "utf8");
  return { log: read("log"), summary: read("summary"), output: read("output") };
}

describe("nightly-issue-sync: a cancelled-only run is re-run, not filed", () => {
  it("the sync step's shell takes every input through env (nothing templated into the script)", () => {
    expect(SCRIPT.length).toBeGreaterThan(500);
    expect(SCRIPT).not.toContain("${{");
  });

  it("attempt 1, only cancelled jobs, no open issue: files nothing, dispatches the one re-run", () => {
    const r = runAction({ status: "failure", jobs: DRIFT_ATTEMPT_1, annotations: { 1: NOT_ACQUIRED } });
    expect(r.log).not.toMatch(/^issue (create|comment|close|edit)/m);
    expect(r.log).toMatch(new RegExp(`^workflow run nightly-red-rerun\\.yml .*-f run_id=${RUN}\\b`, "m"));
    expect(r.output).toContain("verdict=cancelled");
    expect(r.summary).toContain(`gh run rerun ${RUN} --failed`);
  });

  it("an issue already open from an earlier real red gets no \"Still red\" and is not closed", () => {
    const r = runAction({ status: "failure", jobs: DRIFT_ATTEMPT_1, annotations: { 1: NOT_ACQUIRED }, existing: "17" });
    expect(r.log).not.toMatch(/^issue (create|comment|close|edit)/m);
  });

  it("a real failure files exactly as before", () => {
    const failed = [{ id: 1, name: "Diff", status: "completed", conclusion: "failure" }, SELF];
    expect(runAction({ status: "failure", jobs: failed }).log).toMatch(/^issue create .*--title nightly-red: db-drift-detect/m);
    expect(runAction({ status: "failure", jobs: failed, existing: "17" }).log).toMatch(/^issue comment 17 .*Still red/m);
  });

  it("a timeout reported as a cancel files a red, and dispatches nothing", () => {
    const r = runAction({ status: "failure", jobs: A11Y_ATTEMPT_1, annotations: { 1: TIMED_OUT, 2: NOT_ACQUIRED } });
    expect(r.log).toMatch(/^issue create /m);
    expect(r.log).not.toMatch(/^workflow run/m);
  });

  it("a cancel again on the re-run attempt is filed as a red (one retry, never a loop)", () => {
    const r = runAction({ status: "failure", attempt: 2, jobs: DRIFT_ATTEMPT_1, annotations: { 1: NOT_ACQUIRED } });
    expect(r.log).toMatch(/^issue create .*cancelled again on re-run attempt 2/m);
    expect(r.log).not.toMatch(/^workflow run/m);
  });

  it("fail-closed: an unreadable run, or a re-run that cannot be requested, files a red", () => {
    expect(runAction({ status: "failure" }).log).toMatch(/^issue create /m);
    const r = runAction({ status: "failure", jobs: DRIFT_ATTEMPT_1, annotations: { 1: NOT_ACQUIRED }, dispatchRc: 1 });
    expect(r.log).toMatch(/^issue create .*re-run could not be requested/m);
  });

  it("green still closes the open issue", () => {
    const r = runAction({ status: "success", existing: "17" });
    expect(r.log).toMatch(/^issue close 17/m);
    expect(r.output).toContain("verdict=success");
  });
});

// ---- Inventory: every reporting job, and the re-run workflow ----------------

type Wf = { name?: string; permissions?: Record<string, string> | string; jobs?: Record<string, { permissions?: Record<string, string> | string; steps?: { uses?: string }[] }> };

const reporters: { file: string; job: string; perms: Record<string, string> | string | undefined }[] = [];
for (const f of readdirSync(WORKFLOWS).filter((x) => /\.ya?ml$/.test(x)).sort()) {
  const wf = parse(readFileSync(join(WORKFLOWS, f), "utf8")) as Wf;
  for (const [job, def] of Object.entries(wf?.jobs ?? {})) {
    if (!(def?.steps ?? []).some((s) => s?.uses === "./.github/actions/nightly-issue-sync")) continue;
    reporters.push({ file: f, job, perms: def.permissions !== undefined ? def.permissions : wf.permissions });
  }
}

describe("every nightly-red reporter can read its run and dispatch the re-run", () => {
  it("reads the reporting jobs from the workflow files (floor)", () => {
    expect(reporters.length).toBeGreaterThan(40);
    expect(reporters.map((r) => r.file)).toContain("db-drift-detect.yml");
  });

  it.each(reporters.map((r) => [`${r.file}#${r.job}`, r] as const))("%s: actions: write and checks: read", (_label, r) => {
    const p = r.perms;
    const ok = p === "write-all" || (typeof p === "object" && p !== null && p.actions === "write" && (p.checks === "read" || p.checks === "write"));
    expect(ok, `${r.file} job ${r.job} permissions ${JSON.stringify(p)}`).toBe(true);
  });

  it("nightly-red-rerun.yml exists, is dispatch-only, and re-runs --failed only on attempt 1", () => {
    const path = join(WORKFLOWS, "nightly-red-rerun.yml");
    expect(existsSync(path)).toBe(true);
    const src = readFileSync(path, "utf8");
    const wf = parse(src) as Wf & { on?: Record<string, unknown> };
    expect(Object.keys(wf.on ?? {})).toEqual(["workflow_dispatch"]);
    expect((wf.permissions as Record<string, string>).actions).toBe("write");
    const run = Object.values(wf.jobs ?? {}).flatMap((j) => (j.steps ?? []) as { run?: string }[]).map((s) => s.run ?? "").join("\n");
    const gate = run.indexOf('if [ "$ATTEMPT" != "1" ]; then');
    const rerun = run.indexOf('gh run rerun "$RUN_ID" --failed');
    expect(gate).toBeGreaterThan(-1);
    expect(rerun).toBeGreaterThan(gate);
    expect(run.slice(gate, rerun)).toMatch(/exit 0\s*\n\s*fi/);
  });
});
