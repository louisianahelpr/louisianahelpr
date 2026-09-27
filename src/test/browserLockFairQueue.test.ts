/**
 * Q816: lanes waiting on the machine-wide browser lock STARVED. Waiters polled
 * and whichever polled first after a release won, so one lane could lose every
 * race for the full wait while another holder kept the lock. The lock now
 * queues waiters first come, first served, takes over a lock held past
 * LH_BROWSER_LOCK_MAX_HOLD_MIN, and logs who holds it.
 *
 * Isolated via `LH_BROWSER_LOCK_DIR`; never touches the real lock.
 *
 * @mutate e2e/browserLock.ts | return live.length === 0 \|\| live[0].n === ticket; | return true;
 * @mutate e2e/browserLock.ts |       rmSync(join(QUEUE, t.n), { force: true });\n      return false; |       return false;
 * @mutate e2e/browserLock.ts |       if (owner.pid && heldMs > MAX_HOLD_MS) { |       if (false) {
 * @mutate e2e/browserLock.ts |       log("acquire"); |
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
const lockPath = () => join(dir, ".lh-browser.lock");
const queuePath = () => `${lockPath()}.queue`;
const ownerPath = () => join(lockPath(), "owner.json");
const DEAD_PID = 0x7ffffffe;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lh-lockq-"));
  process.env.LH_BROWSER_LOCK_DIR = dir;
  delete process.env.CI;
  delete process.env.LH_BROWSER_LOCK;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.LH_BROWSER_LOCK_DIR;
  delete process.env.LH_BROWSER_LOCK_MAX_HOLD_MIN;
  delete process.env.LH_BROWSER_LOCK_WAIT_MIN;
});

async function freshLock() {
  vi.resetModules();
  return await import("../../e2e/browserLock");
}

describe("browser lock: fair queue, max hold, holder log", () => {
  it("a free lock is NOT taken while an earlier live waiter is queued", async () => {
    mkdirSync(queuePath(), { recursive: true });
    const earlier = `${Date.now() - 60_000}-${process.ppid}`;
    writeFileSync(join(queuePath(), earlier), "");
    process.env.LH_BROWSER_LOCK_WAIT_MIN = "0.03";
    const { acquireBrowserLock } = await freshLock();

    await expect(acquireBrowserLock(), "a later waiter jumped the queue").rejects.toThrow(/queued behind an earlier waiter/);
    expect(existsSync(lockPath())).toBe(false);
    expect(existsSync(join(queuePath(), earlier)), "the earlier waiter keeps its place").toBe(true);
  }, 20_000);

  it("a dead waiter's ticket is pruned and does not block the queue", async () => {
    mkdirSync(queuePath(), { recursive: true });
    const dead = `${Date.now() - 60_000}-${DEAD_PID}`;
    writeFileSync(join(queuePath(), dead), "");
    process.env.LH_BROWSER_LOCK_WAIT_MIN = "0.05";
    const { acquireBrowserLock } = await freshLock();

    await acquireBrowserLock();
    expect(JSON.parse(readFileSync(ownerPath(), "utf8")).pid).toBe(process.pid);
    expect(existsSync(join(queuePath(), dead)), "a crashed waiter's ticket must be removed").toBe(false);
  }, 20_000);

  it("takes over a lock a LIVE pid has held past the max hold time", async () => {
    mkdirSync(lockPath(), { recursive: true });
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
    writeFileSync(ownerPath(), JSON.stringify({ pid: process.ppid, cwd: "/wedged-lane", at: twoHoursAgo }));
    process.env.LH_BROWSER_LOCK_MAX_HOLD_MIN = "60";
    process.env.LH_BROWSER_LOCK_WAIT_MIN = "0.05";
    const { acquireBrowserLock } = await freshLock();

    await acquireBrowserLock();
    expect(JSON.parse(readFileSync(ownerPath(), "utf8")).pid, "one wedged run held every browser lane").toBe(process.pid);
    expect(readFileSync(`${lockPath()}.log`, "utf8")).toMatch(/takeover-overheld .*cwd=\/wedged-lane/);
  }, 20_000);

  it("logs acquire and release with the holder's pid", async () => {
    const { acquireBrowserLock, releaseBrowserLock } = await freshLock();
    await acquireBrowserLock();
    releaseBrowserLock();
    const lines = readFileSync(`${lockPath()}.log`, "utf8").trim().split("\n");
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]).toMatch(new RegExp(`acquire pid=${process.pid}`));
    expect(lines[1]).toMatch(new RegExp(`release pid=${process.pid}`));
  }, 20_000);
});
