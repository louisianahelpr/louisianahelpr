import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import setup, { isWholeRepoRun } from "./gateLockGlobalSetup";

describe("gate lock applies only to whole-repo vitest runs", () => {
  const node = ["node", "/x/vitest"];
  it("locks a bare `vitest run`", () => {
    expect(isWholeRepoRun([...node, "run"])).toBe(true);
    expect(isWholeRepoRun([...node, "run", "--reporter", "dot"])).toBe(true);
  });
  it("skips scoped runs and watch mode", () => {
    expect(isWholeRepoRun([...node, "run", "src/lib/foo.test.ts"])).toBe(false);
    expect(isWholeRepoRun([...node, "run", "--reporter", "dot", "chunkReload"])).toBe(false);
    expect(isWholeRepoRun([...node])).toBe(false);
  });
});

// Q135: vitest runs the root globalSetup once per project (`unit`, `tz-sweep`,
// both `extends: true`) in ONE process. The second call must not wait on the
// lock its own pid already holds, and the lock must survive until the LAST
// teardown.
describe("gate lock is re-entrant within one process (Q135)", () => {
  const saved = { argv: process.argv, env: { ...process.env } };
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lh-gate-q135-"));
    process.env.LH_GATE_LOCK_WAIT_MIN = "0.02"; // a self-wait throws in ~1s instead of hanging 30 min
    // never the real ~/.lh-gate.lock (a worker's process.env.HOME does not reach os.homedir())
    process.env.LH_GATE_LOCK_PATH = join(dir, ".lh-gate.lock");
    delete process.env.CI;
    delete process.env.LH_GATE_LOCK;
    delete process.env.LH_GATE_LOCK_HELD;
    process.argv = ["node", "/x/vitest", "run"];
  });
  afterEach(() => {
    process.argv = saved.argv;
    process.env = { ...saved.env };
    rmSync(dir, { recursive: true, force: true });
  });

  it("setup() twice in-process acquires twice and releases only on the last teardown", async () => {
    const lock = join(dir, ".lh-gate.lock");
    const teardownA = await setup();
    expect(existsSync(lock)).toBe(true);
    const teardownB = await setup(); // the second project: used to wait on its own pid
    expect(typeof teardownA).toBe("function");
    expect(typeof teardownB).toBe("function");
    teardownB!();
    expect(existsSync(lock)).toBe(true); // the other project is still running
    teardownA!();
    expect(existsSync(lock)).toBe(false);
  }, 15_000);
});

// Q135 shown able to fail 2026-09-23: without the own-pid branch the second
// setup() waits on its own pid and throws past the wait limit.
// @mutate scripts/gateLock.mjs | if (owner.pid === process.pid) { | if (owner.pid === -1) {
// And releasing on the first teardown frees the lock while the other project runs.
// @mutate scripts/gateLock.mjs | if (holds() > 1) { | if (holds() > 99) {

// Shown able to fail 2026-09-21: treating a positional file filter as a
// whole-repo run makes every scoped `vitest run <file>` take the machine-wide
// gate lock, so lanes serialise behind one another for no reason.
// @mutate src/test/gateLockGlobalSetup.ts | return false; // a positional file filter | return true; // a positional file filter
// And the other direction: a whole-repo run that skips the lock is the 2026-09-13
// three-at-once load-58 stall.
// @mutate src/test/gateLockGlobalSetup.ts | if (i === -1) return false; | if (i === -1) return false;\n  if (true) return false;
