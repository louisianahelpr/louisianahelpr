/**
 * Owner, 2026-10-04: items verified live are ticked automatically after each
 * deploy (scripts/open-done-when.mjs --tick, .github/workflows/open-auto-tick.yml).
 * tickReady must tick ONLY the READY ids, only `[~]` lines, and carry the evidence;
 * the workflow must run after the three prod deploys and land through a refresh PR.
 */
// @mutate scripts/open-done-when.mjs |       if (!id \|\| !ready.has(id)) return line; |       if (!id) return line;
// @mutate scripts/open-done-when.mjs |       const id = /^- \[~\] \*\*(Q\d+)\b/.exec(line)?.[1]; |       const id = /^- \[.\] \*\*(Q\d+)\b/.exec(line)?.[1];
// @mutate scripts/open-done-when.mjs |     if (stillOpen.length) held.set(it.id, stillOpen); |     if (false) held.set(it.id, stillOpen);
// @mutate .github/workflows/open-auto-tick.yml | regenerate: node scripts/open-sync-trackers.mjs && node | regenerate: node
// @mutate .github/workflows/open-auto-tick.yml |     workflows: ["Supabase DB Deploy", "Supabase Edge Functions Deploy", "Prod deploy"] |     workflows: ["Prod deploy"]
// @mutate .github/workflows/open-done-when.yml | node scripts/open-done-when.mjs --tick --out | node scripts/open-done-when.mjs --tick --no-test --out
// @mutate .github/workflows/open-done-when.yml |           if [ ! -f "$STATUS_FILE" ]; then |           if false; then
// @mutate .github/workflows/open-done-when.yml |           if [ "$STATUS" != "0" ]; then |           if false; then
// @mutate scripts/open-done-when.mjs |     if (!existsSync(mk.path)) throw new Error | if (false) throw new Error
// @mutate scripts/open-done-when.mjs |     const status = problems.length ? 1 : 0; |     const status = 0;
// @mutate scripts/open-done-when.mjs |     out.set(rel, r.status === "passed"); |     out.set(rel, r.status !== "skipped");
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
// @ts-expect-error — plain .mjs script, no declaration file for this export
import { heldBySnapshot, tickReady, testFileResults } from "../../scripts/open-done-when.mjs";

const ROOT = join(__dirname, "..", "..");

describe("auto-tick (open-done-when --tick)", () => {
  const md = [
    "- [~] **Q1 MEDIUM a.** done-when: sql `SELECT 1` => 1",
    "- [~] **Q2 LOW b.** done-when: sql `SELECT 2` => 2",
    "- [ ] **Q3 LOW c.**",
    "- [x] **Q4 LOW d.**",
  ].join("\n");

  it("ticks only the READY [~] items and writes the evidence", () => {
    const out = tickReady(md, new Map([["Q1", "sql reads 1"]]), "2026-10-04").split("\n");
    expect(out[0]).toMatch(/^- \[x\] \*\*Q1 MEDIUM a\..*\*\*DONE 2026-10-04 \(auto-tick, verified live\): .*\(sql reads 1\)\.\*\*$/);
    expect(out.slice(1)).toEqual(md.split("\n").slice(1));
  });

  it("never ticks a to-do [ ] line, even if named", () => {
    const out = tickReady(md, new Map([["Q3", "x"]]), "2026-10-04");
    expect(out).toBe(md);
  });

  it("the workflow runs after the three prod deploys and lands through a refresh PR", () => {
    const wf = parse(readFileSync(join(ROOT, ".github/workflows/open-auto-tick.yml"), "utf8"));
    const names: string[] = wf.on.workflow_run.workflows;
    for (const f of ["db-deploy.yml", "functions-deploy.yml", "prod-deploy.yml"]) {
      const n = /^name:\s*(.+)$/m.exec(readFileSync(join(ROOT, ".github/workflows", f), "utf8"))![1].trim();
      expect(names, `${f} (${n})`).toContain(n);
    }
    const steps = wf.jobs.tick.steps as { uses?: string; with?: Record<string, string> }[];
    const pr = steps.find((s) => s.uses === "./.github/actions/refresh-pr");
    expect(pr?.with?.regenerate).toMatch(/open-done-when\.mjs --tick --no-test/);
    // #2301: the feeds snapshot is re-measured BEFORE the tick, in the same chain.
    expect(pr?.with?.regenerate).toMatch(/^node scripts\/open-sync-trackers\.mjs && node scripts\/open-done-when\.mjs --tick\b/);
  });

  // Bot PR #2301 (2026-10-05): Q1274 was ticked on a live read while the
  // committed snapshot still listed its sources open, so openFeedsMirrored
  // went red. A READY item whose feed is open in the snapshot is held.
  it("holds a READY item whose feed source the snapshot still lists open", () => {
    const feedMd = [
      "- [~] **Q1274 MEDIUM nightly-red: branch-prune is red.** feed: issue #2230 · feed: ledger 7f88b9cc45df. done-when: issue #2230 closed feed: issue #2269. done-when: issue #2269 closed",
      "- [~] **Q5 LOW e.** feed: issue #10. done-when: issue #10 closed",
      "- [~] **Q6 LOW f.** done-when: sql `SELECT 1` => 1",
    ].join("\n");
    const snap = { issues: { open: [{ number: 2269 }] }, ledger: { open: [{ fingerprint: "7f88b9cc45dfe6718fac157d663f3d2e" }] } };
    const held = heldBySnapshot(feedMd, ["Q1274", "Q5", "Q6"], snap);
    expect([...held.keys()]).toEqual(["Q1274"]);
    expect([...held.get("Q1274")].sort()).toEqual(["issue #2269", "ledger 7f88b9cc45df"]);
    expect(heldBySnapshot(feedMd, ["Q1274"], { issues: { open: [] }, ledger: { open: [] } }).size).toBe(0);
  });
});

/*
 * Owner, 2026-10-12: "make it an automated ticking mechanism". open-auto-tick
 * runs --no-test, and the scheduled open-done-when.yml only REPORTED: 58 READY
 * items (most with `test` markers) sat behind nightly-red #2615 untouched. The
 * nightly now ticks them, tests included, through the same refresh-PR
 * contract, and is red only on a marker it cannot read or a crash.
 */
describe("the scheduled open-done-when run ticks, test markers included", () => {
  type Step = { id?: string; uses?: string; run?: string; if?: string; with?: Record<string, string> };
  const wf = parse(readFileSync(join(ROOT, ".github/workflows/open-done-when.yml"), "utf8"));
  const tick = wf.jobs.tick as { needs: string; steps: Step[]; permissions: Record<string, string> };

  it("ticks through the refresh PR, with the test markers, after the prod-load queue", () => {
    expect(tick.needs).toBe("prod-load-turn");
    const pr = tick.steps.find((s) => s.uses === "./.github/actions/refresh-pr");
    const regen = String(pr?.with?.regenerate ?? "");
    expect(regen).toMatch(/^node scripts\/open-sync-trackers\.mjs && node scripts\/open-done-when\.mjs --tick\b/);
    expect(regen).not.toMatch(/--no-test/);
    expect(regen).toMatch(/--status-file "\$RUNNER_TEMP\/done-when\.status"/);
    expect(regen).toMatch(/&& npm run -s inventories:refresh$/);
    expect(pr?.with?.id).toBe("open-done-when");
    expect(tick.permissions).toMatchObject({ contents: "write", "pull-requests": "write" });
  });

  it("the run is red on an unreadable marker and on a crash (no status file), never on READY", () => {
    const res = tick.steps.find((s) => s.id === "result");
    expect(res?.if).toBe("${{ !cancelled() }}");
    const run = String(res?.run ?? "");
    expect(run).toMatch(/if \[ ! -f "\$STATUS_FILE" \]; then\n[^\n]*::error::[^\n]*\n\s*exit 1/);
    expect(run).toMatch(/if \[ "\$STATUS" != "0" \]; then\n[^\n]*::error::[^\n]*\n\s*exit 1/);
    const notify = wf.jobs.notify as { needs: string[]; steps: Step[] };
    expect(notify.needs).toEqual(["tick"]);
    const sync = notify.steps.find((s) => String(s.uses).includes("nightly-issue-sync"));
    expect(sync?.with?.status).toBe("${{ needs.tick.result == 'success' && 'success' || 'failure' }}");
  });

  it("reads per-file results from vitest's JSON report", () => {
    const got = testFileResults(
      { testResults: [{ name: "/r/src/test/a.test.ts", status: "passed" }, { name: "/r/src/test/b.test.tsx", status: "failed" }] },
      "/r",
    );
    expect([...got]).toEqual([["src/test/a.test.ts", true], ["src/test/b.test.tsx", false]]);
  });

  // End to end on a fixture queue, offline (--no-sql; a bus marker reads the
  // committed findings file): the item that holds is ticked, the marker that
  // names a missing test file is a PROBLEM (status 1), and the run still
  // exits 0 so the refresh PR lands the tick.
  it("--status-file: ticks what holds, records a missing test file as a problem, exits 0", () => {
    const dir = mkdtempSync(join(tmpdir(), "done-when-fixture-"));
    const file = join(dir, "OPEN.md");
    const status = join(dir, "status");
    writeFileSync(file, [
      "- [~] **Q1 LOW holds.** done-when: bus V-001 closed",
      "- [~] **Q2 LOW names a test that does not exist.** done-when: test src/test/__no_such_file__.test.ts",
    ].join("\n"));
    const script = join(ROOT, "scripts/open-done-when.mjs");
    const r = spawnSync("node", [script, "--file", file, "--no-sql", "--tick", "--status-file", status], { cwd: ROOT, encoding: "utf8" });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(readFileSync(status, "utf8").trim()).toBe("1");
    const out = readFileSync(file, "utf8").split("\n");
    expect(out[0]).toMatch(/^- \[x\] \*\*Q1 /);
    expect(out[1]).toMatch(/^- \[~\] \*\*Q2 /);
    expect(r.stdout).toMatch(/Q2 \(line 2\): test marker could not run: test marker names src\/test\/__no_such_file__\.test\.ts, which does not exist/);
    // Without --status-file the same problem is a non-zero exit (fail closed).
    const again = spawnSync("node", [script, "--file", file, "--no-sql", "--tick"], { cwd: ROOT, encoding: "utf8" });
    expect(again.status).toBe(1);
  });
});
