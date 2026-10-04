/*
 * CLASS GUARD (docs/OPEN.md Q1161): scheduled prod-load runs are a FIRST-IN,
 * FIRST-SERVED queue, not a last-one-wins slot, so GitHub's cron lag cannot
 * cancel a run or pile suites onto the database.
 *
 * Measured over 84 scheduled prod-load runs (2026-09-24..10-03): crons arrive
 * 127-501 minutes late (median 274). Spaced 2 h apart on paper, they bunch, and
 * under the old shared workflow-level group `prod-load` the third arrival
 * cancelled the pending second one with no job at all (write-contract-refresh
 * 37129164563, 2026-10-03; seven schedule-stalled issues in ten days). Spacing
 * the crons cannot absorb a 374-minute spread across 9-10 prod-load runs a day,
 * so the order is kept by a queue instead: each queued workflow's first job
 * `prod-load-turn` runs scripts/ci/wait-prod-load.mjs, every other job `needs:`
 * it, and the group is per run (nothing to bump).
 *
 * This guard reads the workflow files themselves: every workflow that runs the
 * waiter must carry the whole shape, no workflow may take the shared group
 * again, and the waiter's decision is checked on the shapes that lost runs.
 * It is red on the pre-Q1161 tree (twenty workflows on the shared group, no
 * waiter): the @mutate lines re-prove each clause in the vacuity run.
 */
// @mutate scripts/ci/wait-prod-load.mjs | r.id !== me.id && older(r, me) && | r.id !== me.id &&
// @mutate scripts/ci/wait-prod-load.mjs | <= STALE_RUN_MS) | <= 1e15)
// @mutate scripts/ci/wait-prod-load.mjs | .some((l) => !/^\s*#/.test(l) && l.includes(WAITER_COMMAND)), | .some((l) => false),
// @mutate scripts/ci/wait-prod-load.mjs | if (process.env.GITHUB_EVENT_NAME !== "schedule" && | if (false &&
// @mutate scripts/ci/wait-prod-load.mjs | export const WAIT_BUDGET_MS = 340 * 60_000; | export const WAIT_BUDGET_MS = 340 * 60_000_000;
// @mutate scripts/ci/wait-prod-load.mjs | gh(`/repos/${repo}/actions/runs?event=schedule&status=${status} | gh(`/repos/${repo}/actions/runs?status=${status}
// @mutate .github/workflows/db-backup.yml |   backup:\n    needs: prod-load-turn\n |   backup:\n
// @mutate .github/workflows/db-backup.yml |     timeout-minutes: 350\n    permissions:\n      actions: read |     timeout-minutes: 350\n    permissions:\n      actions: none
// @mutate .github/workflows/db-backup.yml | group: ${{ format('db-backup-{0}', github.run_id) }} | group: ${{ github.event_name == 'schedule' && 'prod-load' \|\| format('db-backup-{0}', github.run_id) }}
// @mutate .github/workflows/e2e-real-backend.yml |   anon-surface:\n    needs: prod-load-turn\n |   anon-surface:\n
import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
// @ts-expect-error - plain .mjs tool script, no types
import * as queue from "../../scripts/ci/wait-prod-load.mjs";
import { STALE_RUN_MS } from "../../scripts/e2e/wait-shared-accounts.mjs";

type Run = { id: number; created_at: string; name?: string; html_url?: string };
const decide = queue.decide as (me: { id: number; created_at: string }, runs: Run[]) => { go: boolean; why: string };
const queuedWorkflows = queue.queuedWorkflows as (dir?: string) => string[];
const snapshot = queue.snapshot as (repo: string, token: string, members: Set<string>) => Promise<Run[]>;
const WAITER_COMMAND = queue.WAITER_COMMAND as string;

const ROOT = resolve(__dirname, "../..");
const WF_DIR = resolve(ROOT, ".github/workflows");
type Job = {
  needs?: string | string[];
  "timeout-minutes"?: number;
  permissions?: Record<string, string>;
  steps?: { run?: string; with?: Record<string, string> }[];
};
type Wf = { concurrency?: { group?: string; "cancel-in-progress"?: unknown }; jobs?: Record<string, Job> };
const wfs = readdirSync(WF_DIR)
  .filter((f) => /\.ya?ml$/.test(f))
  .sort()
  .map((f) => ({ file: f, src: readFileSync(resolve(WF_DIR, f), "utf8"), doc: parse(readFileSync(resolve(WF_DIR, f), "utf8")) as Wf }));
const queued = wfs.filter((w) => (w.doc.jobs?.["prod-load-turn"]?.steps ?? []).some((s) => String(s.run ?? "").includes(WAITER_COMMAND)));
const needsOf = (j: Job) => (j.needs === undefined ? [] : [j.needs].flat());

describe("Q1161: scheduled prod-load runs wait in a FIFO queue", () => {
  it("reads the queue's members from the workflow files (floor), and the waiter agrees", () => {
    expect(queued.length).toBeGreaterThan(15);
    for (const f of ["press-every-control.yml", "e2e-journeys.yml", "e2e-real-backend.yml", "db-backup.yml", "privacy-journey.yml", "vacuity.yml"]) {
      expect(queued.map((w) => w.file)).toContain(f);
    }
    expect(queuedWorkflows(WF_DIR)).toEqual(queued.map((w) => `.github/workflows/${w.file}`));
  });

  it("every queued workflow has the whole shape: a bounded read-only first job, every other job behind it, a per-run group", () => {
    const bad: string[] = [];
    for (const { file, doc } of queued) {
      const jobs = doc.jobs ?? {};
      const turn = jobs["prod-load-turn"];
      if (!turn.steps?.some((s) => s.run === WAITER_COMMAND)) bad.push(`${file}: prod-load-turn must run exactly "${WAITER_COMMAND}"`);
      if (needsOf(turn).length) bad.push(`${file}: prod-load-turn must be the first job (it has needs)`);
      if (!((turn["timeout-minutes"] ?? 0) >= 300 && (turn["timeout-minutes"] ?? 0) <= 360)) bad.push(`${file}: prod-load-turn timeout must be 300-360 min (the queue ahead may hold several runs)`);
      if (turn.permissions?.actions !== "read" || turn.permissions?.contents !== "read") bad.push(`${file}: prod-load-turn needs actions: read and contents: read (and nothing more)`);
      const sparse = turn.steps?.find((s) => s.with?.["sparse-checkout"])?.with?.["sparse-checkout"] ?? "";
      for (const need of [".github/workflows", "scripts/ci/wait-prod-load.mjs", "scripts/e2e/wait-shared-accounts.mjs"]) {
        if (!sparse.split("\n").map((l) => l.trim()).includes(need)) bad.push(`${file}: the waiter's sparse checkout lacks ${need} (it imports it / reads the inventory)`);
      }
      // Every job reaches prod-load-turn through its needs chain, or it would run ahead of the queue.
      const behind = (name: string, seen = new Set<string>()): boolean => {
        if (name === "prod-load-turn") return true;
        if (seen.has(name)) return false;
        seen.add(name);
        return needsOf(jobs[name]).some((n) => jobs[n] && behind(n, seen));
      };
      for (const name of Object.keys(jobs)) if (!behind(name)) bad.push(`${file}: job "${name}" does not wait for prod-load-turn`);
      const group = doc.concurrency?.group ?? "";
      if (!group || /prod-load/.test(group)) bad.push(`${file}: workflow group "${group}" must be per run, not prod-load`);
      if (doc.concurrency?.["cancel-in-progress"] !== false) bad.push(`${file}: cancel-in-progress must stay false`);
    }
    expect(bad.join("\n")).toBe("");
  });

  it("no workflow takes the shared prod-load group again, for any event", () => {
    const shared = wfs.filter((w) => /prod-load/.test(w.doc.concurrency?.group ?? "")).map((w) => w.file);
    expect(shared, "the shared group cancels the pending run when a third arrives").toEqual([]);
    const jobShared = wfs.filter((w) => Object.values(w.doc.jobs ?? {}).some((j) => /prod-load/.test(JSON.stringify((j as { concurrency?: unknown }).concurrency ?? "")))).map((w) => w.file);
    expect(jobShared).toEqual([]);
  });

  it("decide(): older scheduled runs go first, a younger one never blocks, and ties break by id", () => {
    const run = (id: number, created_at: string): Run => ({ id, created_at, name: `run ${id}`, html_url: `https://x/${id}` });
    const me = { id: 30, created_at: "2026-10-03T15:08:00Z" };
    expect(decide(me, []).go).toBe(true);
    const ahead = decide(me, [run(10, "2026-10-03T14:18:55Z"), run(20, "2026-10-03T15:07:00Z")]);
    expect(ahead.go).toBe(false);
    expect(ahead.why).toMatch(/2 older/);
    expect(ahead.why).toContain("https://x/10"); // names the oldest
    // Younger runs wait for me, not I for them.
    expect(decide(me, [run(40, "2026-10-03T15:09:00Z")]).go).toBe(true);
    // Same second: the lower run id is first.
    expect(decide({ id: 31, created_at: "2026-10-03T15:08:00Z" }, [run(30, "2026-10-03T15:08:00Z")]).go).toBe(false);
    expect(decide({ id: 30, created_at: "2026-10-03T15:08:00Z" }, [run(31, "2026-10-03T15:08:00Z")]).go).toBe(true);
    // Never itself.
    expect(decide(me, [run(30, "2026-10-03T15:08:00Z")]).go).toBe(true);
  });

  it("decide(): the 2026-10-03 pile-up is served in delivery order, one at a time", () => {
    // press-every-control running since 09:07, write-contract-refresh delivered 14:18:55, e2e-real-backend 15:07:59.
    const press = { id: 1, created_at: "2026-10-03T09:07:00Z" };
    const write = { id: 2, created_at: "2026-10-03T14:18:55Z" };
    const real = { id: 3, created_at: "2026-10-03T15:07:59Z" };
    const inFlight = [press, write, real];
    expect(decide(press, inFlight).go).toBe(true);
    expect(decide(write, inFlight).go).toBe(false);
    expect(decide(real, inFlight).go).toBe(false);
    const afterPress = [write, real];
    expect(decide(write, afterPress).go).toBe(true);
    expect(decide(real, afterPress).go).toBe(false);
    expect(decide(real, [real]).go).toBe(true);
    // Exactly one of any two in-flight runs may go: they can never wait on each other.
    for (const [a, b] of [[press, write], [write, real], [press, real]]) {
      expect([decide(a, [a, b]).go, decide(b, [a, b]).go].filter(Boolean)).toHaveLength(1);
    }
  });

  it("decide(): a GitHub ghost older than STALE_RUN_MS does not hold the queue", () => {
    const me = { id: 9, created_at: "2026-10-03T20:00:00Z" };
    const ghost = { id: 1, created_at: new Date(Date.parse(me.created_at) - STALE_RUN_MS - 60_000).toISOString() };
    const real = { id: 2, created_at: new Date(Date.parse(me.created_at) - STALE_RUN_MS + 60_000).toISOString() };
    expect(decide(me, [ghost]).go).toBe(true);
    expect(decide(me, [real]).go).toBe(false);
  });

  it("the wait is bounded under the job's own timeout: a long queue runs the check late, not never", () => {
    const WAIT_BUDGET_MS = queue.WAIT_BUDGET_MS as number;
    const budgetSpent = queue.budgetSpent as (startedAt: number, now?: number) => boolean;
    expect(budgetSpent(0, WAIT_BUDGET_MS - 1)).toBe(false);
    expect(budgetSpent(0, WAIT_BUDGET_MS)).toBe(true);
    for (const { file, doc } of queued) {
      const timeout = doc.jobs?.["prod-load-turn"]["timeout-minutes"] ?? 0;
      expect(WAIT_BUDGET_MS / 60_000, `${file}: the budget must end before the job's ${timeout}-minute timeout`).toBeLessThan(timeout);
    }
    // GitHub's hosted-job ceiling is 360 minutes.
    expect(WAIT_BUDGET_MS / 60_000).toBeLessThan(360);
  });

  describe("the run snapshot", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("asks for scheduled runs only, in every in-flight status, and keeps only queued workflows", async () => {
      const mk = (id: number, path: string) => ({ id, created_at: `2026-10-03T0${id}:00:00Z`, name: path, html_url: `u${id}`, path });
      const fetchMock = vi.fn(async (url: string) => {
        const status = /status=(\w+)/.exec(url)![1];
        const rs = status === "queued" ? [mk(1, ".github/workflows/db-backup.yml@refs/heads/main"), mk(2, ".github/workflows/ci.yml@refs/heads/main")] : status === "in_progress" ? [mk(3, ".github/workflows/db-backup.yml"), mk(1, ".github/workflows/db-backup.yml@refs/heads/main")] : [];
        return { ok: true, json: async () => ({ workflow_runs: rs }) };
      });
      vi.stubGlobal("fetch", fetchMock);
      const got = await snapshot("o/r", "t", new Set([".github/workflows/db-backup.yml"]));
      // What the code under test asked GitHub for (the mock's own record).
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls).toHaveLength(5);
      for (const u of urls) expect(u).toContain("event=schedule");
      expect(urls.map((u) => /status=(\w+)/.exec(u)![1]).sort()).toEqual(["in_progress", "pending", "queued", "requested", "waiting"]);
      expect(got.map((r) => r.id).sort()).toEqual([1, 3]); // ci.yml is not a member; run 1 is listed once
    });
  });

  it("the script exits at once for a dispatch, and runs unqueued (loudly) when it cannot read the API", () => {
    const run = (env: Record<string, string>) =>
      execFileSync("node", ["scripts/ci/wait-prod-load.mjs"], { cwd: ROOT, encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...env }, timeout: 20_000 });
    expect(run({ GITHUB_EVENT_NAME: "workflow_dispatch" })).toMatch(/neither queues nor blocks/);
    expect(run({ GITHUB_EVENT_NAME: "schedule" })).toMatch(/::warning title=Prod-load queue not checked::/);
  });
});
