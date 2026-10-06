/**
 * One red, one ledger item (2026-09-27). quota-monitor run 36285625149 was
 * red on ONE job (db_pool_budget, "pools may hold 67 connections but only 57
 * are usable"), yet the ledger showed it only as the generic nightly_red item
 * 79f3fe46 (recorded by `sync` from its nightly-red issue #1890), and
 * `list --fail-on-dupes` grouped that with the unrelated Q379 quota warning
 * d2df1e5e, turning prod-errors.yml red every hour. The class: a workflow whose
 * checks record their own items must not ALSO get a generic nightly_red item.
 *
 *  - every red path of a quota-monitor check records its own item with
 *    failingRunRef() and verifyRef "quota-monitor.yml" (so step 3 of `sync`
 *    closes it on a green run);
 *  - selfRecordingWorkflows() derives, from the workflow files, which
 *    workflows are like that (no hand list);
 *  - `sync` records / retires the generic item only by redRunCovered(), and
 *    `record` skips it for those workflows. The nightly-red issue is unchanged.
 *
 * @mutate scripts/check-db-pool-budget.mjs | sampleRef: failingRunRef(), | sampleRef: {},
 * @mutate scripts/check-quota-usage.mjs | sampleRef: { ...failingRunRef(), quota: r.q.id }, | sampleRef: { quota: r.q.id },
 * @mutate scripts/check-stripe-balance.mjs | sample, sampleRef: failingRunRef() }); | sample, sampleRef: {} });
 * @mutate scripts/check-analytics-freshness.mjs | sampleRef: failingRunRef(), | sampleRef: {},
 * @mutate scripts/lib/opsAlertLedger.mjs | .filter((r) => r !== PROD_LOAD_QUEUE_STEP); | .filter((r) => r === PROD_LOAD_QUEUE_STEP);
 * @mutate scripts/lib/opsAlertLedger.mjs | return jobs.size >= failedJobs; | return jobs.size >= 0;
 * @mutate scripts/lib/opsAlertLedger.mjs | if (!ref.fails_run) continue; | if (false) continue;
 * @mutate scripts/lib/opsAlertLedger.mjs | if (scripts.some((p) => !p)) continue; | if (false) continue;
 * @mutate scripts/ops-alert-ledger.mjs | const own = sourceKind === "nightly_red" ? selfRecordingContext().of(title) : null; | const own = null;
 * @mutate scripts/ops-alert-ledger.mjs | if (c.covered) { | if (false) {
 * @mutate scripts/ops-alert-ledger.mjs | if (c.covered && new Date(c.run.createdAt) > new Date(it.last_seen)) { | if (c.covered) {
 *
 * The deploy pair (2026-10-06, prod-errors run 37503454646): functions-deploy
 * run 37427510927 was red, its `if: failure()` step recorded 0ac97ff0
 * workflow/functions-deploy AND main-red-watch's nightly-red issue became
 * 8b635b8c nightly_red; `list --fail-on-dupes` turned prod-errors red (#2463)
 * for a red that already had its item. A failure step that records with
 * `--fails-run` now covers its own job, and every `--fails-run` must sit in an
 * `if: failure()` step (an unconditional one would claim every run red).
 *
 * @mutate .github/workflows/functions-deploy.yml | --verify-ref "functions-deploy.yml" --fails-run | --verify-ref "functions-deploy.yml"
 * @mutate .github/workflows/db-deploy.yml | --verify-ref "db-deploy.yml" --fails-run | --verify-ref "db-deploy.yml"
 * @mutate .github/workflows/db-deploy.yml | if: failure() && steps.precheck.outputs.skip != 'true' | if: steps.precheck.outputs.skip != 'true'
 * @mutate scripts/lib/opsAlertLedger.mjs | if (failureStepRecorders(src).includes(`${base}.yml`)) { | if (false) {
 * @mutate scripts/lib/opsAlertLedger.mjs | if (!/\s--fails-run\b/.test(line)) continue; | if (false) continue;
 * @mutate scripts/ops-alert-ledger.mjs | sampleRef: flag("fails-run") ? | sampleRef: false ?
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
// @ts-expect-error untyped .mjs (same as opsLedgerFlagsDuplicateWorkflowItems.test.ts)
import { failureStepRecorders, redRunCovered, selfRecordingWorkflows } from "../../scripts/lib/opsAlertLedger.mjs";

const ROOT = resolve(__dirname, "../..");
const WF = join(ROOT, ".github/workflows");
const FILES = readdirSync(WF)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ file: f, text: readFileSync(join(WF, f), "utf8") }));
const readScript = (p: string) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), "utf8") : null);
const SELF: Set<string> = selfRecordingWorkflows(FILES, readScript);

const RUN = "https://github.com/o/r/actions/runs/36285625149";
const DB_POOL = { id: "a1", source: "db-pool-budget", sample_ref: { run_url: RUN, job: "db_pool_budget", fails_run: true } };
// d2df1e5e: a warning recorded by the SAME run (check-quota-usage.mjs puts its
// run_url on it) while the quota job itself stays green: it must not cover.
const REPLAYS = { id: "d2df1e5e", source: "quota-monitor", sample_ref: { run_url: RUN, quota: "sentry_replays" } };

describe("self-recording workflows: one red, one ledger item", () => {
  it("quota-monitor is derived as self-recording from its files", () => {
    // Floor: the workflow read must see the 61 files there were on 2026-09-27.
    expect(FILES.length).toBeGreaterThan(60);
    expect([...SELF]).toContain("quota-monitor");
  });

  it("every check quota-monitor runs records its red with failingRunRef and verifyRef quota-monitor.yml", () => {
    const yml = FILES.find((f) => f.file === "quota-monitor.yml")!.text;
    const scripts = [...yml.matchAll(/^\s*run:\s*node (scripts\/\S+\.mjs)\s*$/gm)].map((m) => m[1]).filter((p) => p !== "scripts/ci/wait-prod-load.mjs"); // the Q1161 queue job is not a check
    expect(scripts.length).toBeGreaterThan(3);
    for (const s of scripts) {
      const code = blankComments(readFileSync(join(ROOT, s), "utf8"));
      expect(code, s).toMatch(/failingRunRef\(/);
      expect(code, s).toMatch(/verifyRef:\s*"quota-monitor\.yml"/);
    }
  });

  it("a workflow with a step that is not a self-recording check is not derived", () => {
    const base = FILES.find((f) => f.file === "quota-monitor.yml")!;
    const extra = { file: "x.yml", text: `${base.text}\n      - run: npm test\n` };
    const flagged = { file: "y.yml", text: base.text.replace(/node scripts\/check-db-pool-budget\.mjs/, "node scripts/check-db-pool-budget.mjs --no-ledger") };
    const noRef = (p: string) => (readScript(p) ?? "").replace(/failingRunRef\(/g, "x(");
    expect(selfRecordingWorkflows([extra, flagged], readScript).size).toBe(0);
    expect(selfRecordingWorkflows([base], noRef).size).toBe(0);
  });

  it("redRunCovered: covered only when every failed job of THAT run recorded a fails_run item", () => {
    expect(redRunCovered({ runId: 36285625149, failedJobs: 1, items: [DB_POOL, REPLAYS] })).toBe(true);
    // RED on the live pair: the Q379 warning item does not cover a red run
    expect(redRunCovered({ runId: 36285625149, failedJobs: 1, items: [REPLAYS] })).toBe(false);
    // two jobs failed, one recorded
    expect(redRunCovered({ runId: 36285625149, failedJobs: 2, items: [DB_POOL, REPLAYS] })).toBe(false);
    // an item from an older run
    expect(redRunCovered({ runId: 1, failedJobs: 1, items: [DB_POOL] })).toBe(false);
    // no failed job (cancelled, timed out): never covered
    expect(redRunCovered({ runId: 36285625149, failedJobs: 0, items: [DB_POOL] })).toBe(false);
    const str = { ...DB_POOL, sample_ref: JSON.stringify(DB_POOL.sample_ref) };
    expect(redRunCovered({ runId: 36285625149, failedJobs: 1, items: [str] })).toBe(true);
  });

  it("the CLI gates the generic item on the derived set and on coverage", () => {
    const cli = blankComments(readFileSync(join(ROOT, "scripts/ops-alert-ledger.mjs"), "utf8"));
    // record: skipped for self-recording workflows
    expect(cli).toMatch(/const own = sourceKind === "nightly_red" \? selfRecordingContext\(\)\.of\(title\) : null;\s*if \(own\) \{[\s\S]{0,700}?return;/);
    // sync step 1: skipped only when covered, else recorded (fail safe)
    expect(cli).toMatch(/const own = selfRec\.of\(i\.title\);[\s\S]{0,200}?if \(c\.covered\) \{[\s\S]{0,300}?continue;/);
    // sync step 2b: retired only after a later covered run
    expect(cli).toMatch(/if \(c\.covered && new Date\(c\.run\.createdAt\) > new Date\(it\.last_seen\)\) \{\s*evidence = `superseded:/);
    expect(cli).toMatch(/covered: redRunCovered\(\{ runId: run\.databaseId, failedJobs, items \}\)/);
  });
});

describe("deploy workflows' failure steps: one red, one ledger item (#2463)", () => {
  // A workflow split at each step start (`- name:` / `- uses:` / `- run:`), so each piece carries its own `if:`.
  const steps = (text: string) => text.split(/\n(?=\s*-\s+(?:name|uses|run):)/);

  it("every `record --fails-run` sits in a step gated on if: failure(), and names its own workflow", () => {
    let n = 0;
    for (const { file, text } of FILES) {
      for (const step of steps(text)) {
        const refs: string[] = failureStepRecorders(step);
        if (!refs.length) continue;
        n += refs.length;
        const cond = /^\s*(?:-\s+)?if:\s*(.*)$/m.exec(step)?.[1] ?? "";
        expect(cond, `${file}: a --fails-run record outside an if: failure() step`).toMatch(/\bfailure\(\)/);
        for (const r of refs) expect(r, file).toBe(file);
      }
    }
    // Floor: functions-deploy, db-deploy and deploy (iOS) record this way.
    expect(n).toBeGreaterThanOrEqual(3);
  });

  it("functions-deploy, db-deploy and deploy are derived as self-recording", () => {
    expect([...SELF]).toEqual(expect.arrayContaining(["functions-deploy", "db-deploy", "deploy"]));
  });

  it("the live pair: functions-deploy's own item covers its red run, so its nightly-red issue is not a second item", () => {
    const run = "https://github.com/louisianahelpr/louisianahelpr/actions/runs/37427510927";
    const own = { id: "0ac97ff0", source: "functions-deploy", sample_ref: { run_url: run, job: "deploy", fails_run: true } };
    expect(redRunCovered({ runId: 37427510927, failedJobs: 1, items: [own] })).toBe(true);
    // What the step recorded before --fails-run: it never covered the red, so sync added 8b635b8c beside it.
    const before = { ...own, sample_ref: { run_url: run } };
    expect(redRunCovered({ runId: 37427510927, failedJobs: 1, items: [before] })).toBe(false);
  });

  it("failureStepRecorders joins continuations and ignores a record without --fails-run", () => {
    const yml = [
      "run: |",
      '  node scripts/ops-alert-ledger.mjs record --source-kind workflow --source "x" \\',
      '    --verify-ref "x.yml" --fails-run \\',
      '    --run-url "u" || true',
      '  node scripts/ops-alert-ledger.mjs record --verify-ref "y.yml"',
    ].join("\n");
    expect(failureStepRecorders(yml)).toEqual(["x.yml"]);
  });

  it("the CLI gives a --fails-run item its run and job (failingRunRef)", () => {
    const cli = blankComments(readFileSync(join(ROOT, "scripts/ops-alert-ledger.mjs"), "utf8"));
    expect(cli).toMatch(/sampleRef: flag\("fails-run"\) \? \{ \.\.\.failingRunRef\(\),/);
  });
});
