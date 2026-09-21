/**
 * THE MACHINE-WIDE BROWSER LOCK, WHICH NOTHING TESTED.
 *
 * `e2e/browserLock.ts` serialises browser runs across every local checkout
 * (owner, 2026-09-12: "browser work runs one agent at a time"). Before it,
 * two sweeps on one machine fought over port 4173 and CPU until the results
 * were meaningless.
 *
 * Until 2026-09-21 the only references to it were `globalSetup` and
 * `globalTeardown` — no test anywhere. Both of its load-bearing behaviours
 * went unproven, and both were exercised for real that night:
 *
 *   1. a lock whose owner pid is DEAD must be taken over. A lane was blocked
 *      by a stale lock held by pid 5431, long exited. Without takeover a
 *      crashed run blocks the machine for the full 90-minute wait.
 *   2. release must remove the lock ONLY if we own it. A second lane deleted
 *      the lock directory unconditionally at teardown and reported that it may
 *      have stolen another lane's lock. `releaseBrowserLock` would never do
 *      that — the ownership check is the reason — but nothing proved it.
 *
 * Isolated via `LH_BROWSER_LOCK_DIR` so this never touches the real
 * `~/.lh-browser.lock`.
 *
 * @mutate e2e/browserLock.ts |       if (owner.pid && !alive(owner.pid)) { |       if (false) {
 * @mutate e2e/browserLock.ts |         if (ageMs > ORPHAN_GRACE_MS) { |         if (false) {
 * @mutate e2e/browserLock.ts |     if (owner.pid === process.pid) rmSync(LOCK, { recursive: true, force: true }); |     rmSync(LOCK, { recursive: true, force: true });
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
const lockPath = () => join(dir, ".lh-browser.lock");
const ownerPath = () => join(lockPath(), "owner.json");

/** A pid that cannot be alive: allocate one, then prove it is gone. */
const DEAD_PID = 0x7ffffffe;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lh-lock-"));
  process.env.LH_BROWSER_LOCK_DIR = dir;
  delete process.env.CI;
  delete process.env.LH_BROWSER_LOCK;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.LH_BROWSER_LOCK_DIR;
});

/**
 * Import fresh each time: `LOCK` is resolved at module LOAD from the env, so a
 * cached module would carry the previous test's directory. `vi.resetModules()`
 * rather than a cache-busting query string — Vite cannot resolve a dynamic
 * import whose specifier is not statically analysable.
 */
async function freshLock() {
  vi.resetModules();
  return await import("../../e2e/browserLock");
}

describe("the browser lock", () => {
  it("takes over a lock whose owner pid is dead", async () => {
    mkdirSync(lockPath(), { recursive: true });
    writeFileSync(ownerPath(), JSON.stringify({ pid: DEAD_PID, cwd: "/gone", at: "2026-09-20T00:00:00Z" }));
    const { acquireBrowserLock } = await freshLock();

    // Without takeover this waits out LH_BROWSER_LOCK_WAIT_MIN and throws.
    process.env.LH_BROWSER_LOCK_WAIT_MIN = "0.001";
    await acquireBrowserLock();

    expect(
      JSON.parse(readFileSync(ownerPath(), "utf8")).pid,
      "a crashed run must not hold the machine — the stale lock should have been taken over",
    ).toBe(process.pid);
  }, 20_000);

  /**
   * THE ORPHANED LOCK — a third way to wedge the machine, found 2026-09-21 by
   * being wedged by it.
   *
   * `~/.lh-browser.lock` existed with no `owner.json` inside. The takeover rule
   * is `owner.pid && !alive(owner.pid)`, so with no readable owner there is no
   * pid, takeover never fires, and the lock is immortal: the overlay sweep
   * printed "waiting for pid undefined in undefined" and would have waited the
   * full 90-minute LH_BROWSER_LOCK_WAIT_MIN before throwing. Every browser
   * guard on the machine is blocked for that whole time, by debris.
   *
   * This is the worst failure shape a lock can have — it converts ONE crashed
   * run into an outage of every browser lane — and it was the one case the two
   * tests above did not cover.
   */
  it("reclaims a lock directory that has no owner.json", async () => {
    mkdirSync(lockPath(), { recursive: true });
    // No owner.json at all: exactly the state found on the machine.
    process.env.LH_BROWSER_LOCK_ORPHAN_GRACE_MS = "0";
    process.env.LH_BROWSER_LOCK_WAIT_MIN = "0.05";
    const { acquireBrowserLock } = await freshLock();

    await acquireBrowserLock();

    expect(
      JSON.parse(readFileSync(ownerPath(), "utf8")).pid,
      "an ownerless lock directory is debris, not a live run — it must be reclaimed, " +
        "or one crashed process blocks every browser lane on the machine for 90 minutes",
    ).toBe(process.pid);
    delete process.env.LH_BROWSER_LOCK_ORPHAN_GRACE_MS;
  }, 20_000);

  /**
   * The other side of it: the grace window must be long enough that an acquirer
   * caught between `mkdirSync` and `writeFileSync` is never robbed of the lock
   * it just took.
   */
  it("does not reclaim a lock whose owner.json is only momentarily missing", async () => {
    mkdirSync(lockPath(), { recursive: true });
    process.env.LH_BROWSER_LOCK_ORPHAN_GRACE_MS = "600000";
    process.env.LH_BROWSER_LOCK_WAIT_MIN = "0.005";
    const { acquireBrowserLock } = await freshLock();

    await expect(
      acquireBrowserLock(),
      "a lock taken microseconds ago must be respected, not stolen",
    ).rejects.toThrow(/past the wait limit/);
    delete process.env.LH_BROWSER_LOCK_ORPHAN_GRACE_MS;
  }, 20_000);

  it("does NOT release a lock owned by someone else", async () => {
    mkdirSync(lockPath(), { recursive: true });
    // A LIVE owner — this process's parent is alive by definition.
    writeFileSync(ownerPath(), JSON.stringify({ pid: process.ppid, cwd: "/other-lane", at: "x" }));
    const { releaseBrowserLock } = await freshLock();

    releaseBrowserLock();

    expect(
      existsSync(lockPath()),
      "teardown deleted a lock this process never owned — that is how one lane steals another's",
    ).toBe(true);
  });

  it("releases the lock it does own", async () => {
    const { acquireBrowserLock, releaseBrowserLock } = await freshLock();
    await acquireBrowserLock();
    expect(existsSync(lockPath())).toBe(true);
    releaseBrowserLock();
    expect(existsSync(lockPath()), "a run that finishes must free the machine").toBe(false);
  }, 20_000);

  it("is a no-op in CI, where each job has its own machine", async () => {
    process.env.CI = "1";
    const { acquireBrowserLock, lockDisabled } = await freshLock();
    expect(lockDisabled()).toBe(true);
    await acquireBrowserLock();
    expect(existsSync(lockPath()), "CI must not serialise on a machine-wide lock").toBe(false);
  });
});
