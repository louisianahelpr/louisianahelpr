/**
 * One browser run at a time across every local checkout (owner, 2026-09-12:
 * browser work runs one agent at a time). Before this, agents were paused and
 * released by hand, and two sweeps on one machine fought over port 4173 and
 * CPU until results were meaningless.
 *
 * Acquired in globalSetup, released in globalTeardown. `mkdir` is atomic, so
 * two runs cannot both take it. A lock whose owner pid is dead is stale and is
 * taken over. Waits up to LH_BROWSER_LOCK_WAIT_MIN (default 90) minutes.
 * Skipped in CI, where each job has its own machine. LH_BROWSER_LOCK=0 bypasses.
 */
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * `LH_BROWSER_LOCK_DIR` exists so this file can be TESTED without touching the
 * real machine-wide lock. Until 2026-09-21 nothing in the repo referenced this
 * module at all — the two behaviours below were load-bearing for every browser
 * lane and entirely unproven:
 *
 *   - a lock whose owner pid is dead must be TAKEN OVER (a crashed run must not
 *     block the machine for 90 minutes), and
 *   - release must remove the lock ONLY if we own it.
 *
 * Both were exercised for real that night: a stale lock held by a dead pid
 * blocked a lane, and another lane deleted the lock directory unconditionally
 * at teardown — which `releaseBrowserLock` itself would never do, precisely
 * because of the ownership check.
 */
const LOCK = join(process.env.LH_BROWSER_LOCK_DIR ?? homedir(), ".lh-browser.lock");
const OWNER = join(LOCK, "owner.json");

/**
 * How long a lock directory may exist with no `owner.json` before it is treated
 * as debris rather than as a live acquirer mid-handshake. Overridable so the
 * test does not have to wait it out.
 */
const ORPHAN_GRACE_MS = Number(process.env.LH_BROWSER_LOCK_ORPHAN_GRACE_MS ?? 30_000);

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { /* ESRCH: that pid has exited, so its lock is stale */ return false; }
}

export function lockDisabled(): boolean {
  return !!process.env.CI || process.env.LH_BROWSER_LOCK === "0";
}

export async function acquireBrowserLock(): Promise<void> {
  if (lockDisabled()) return;
  const deadline = Date.now() + Number(process.env.LH_BROWSER_LOCK_WAIT_MIN ?? 90) * 60_000;
  let announced = false;
  for (;;) {
    try {
      mkdirSync(LOCK);
      writeFileSync(OWNER, JSON.stringify({ pid: process.pid, cwd: process.cwd(), at: new Date().toISOString() }));
      return;
    } catch {
      let owner: { pid?: number; cwd?: string } = {};
      let ownerReadable = false;
      try { owner = JSON.parse(readFileSync(OWNER, "utf8")); ownerReadable = true; } catch { /* owner file not written yet — see the orphan branch below */ }
      if (owner.pid && !alive(owner.pid)) {
        rmSync(LOCK, { recursive: true, force: true });
        continue;
      }
      // ORPHANED LOCK: the directory exists and owner.json does not.
      //
      // The takeover rule above is `owner.pid && !alive(owner.pid)`, so with no
      // readable owner.json there is no pid, the branch never fires, and the
      // lock is immortal: every browser lane on the machine waits the full
      // LH_BROWSER_LOCK_WAIT_MIN (default NINETY MINUTES) and then throws.
      // Reproduced for real 2026-09-21 — `~/.lh-browser.lock` sat empty from
      // 11:54 and the overlay sweep printed "waiting for pid undefined in
      // undefined" until it was cleared by hand. A lock that cannot be
      // reclaimed is strictly worse than no lock: it converts one crashed run
      // into a machine-wide outage of every browser guard.
      //
      // `writeFileSync(OWNER)` runs on the line after `mkdirSync(LOCK)`, so the
      // window in which a LIVE acquirer legitimately has no owner.json is
      // microseconds. The grace period below is orders of magnitude larger than
      // that window, so a racing acquirer is never robbed, while debris from a
      // process killed inside it is cleared on the next poll.
      if (!ownerReadable) {
        let ageMs = Infinity;
        try { ageMs = Date.now() - statSync(LOCK).mtimeMs; } catch { /* vanished under us — retry the mkdir */ continue; }
        if (ageMs > ORPHAN_GRACE_MS) {
          console.log(`[browser-lock] ${LOCK} has no owner.json and is ${Math.round(ageMs / 1000)}s old — reclaiming an orphaned lock.`);
          rmSync(LOCK, { recursive: true, force: true });
          continue;
        }
      }
      if (Date.now() > deadline) {
        throw new Error(`Browser lock ${LOCK} held by pid ${owner.pid} (${owner.cwd}) past the wait limit.`);
      }
      if (!announced) {
        console.log(`[browser-lock] waiting for pid ${owner.pid} in ${owner.cwd} to finish its browser run…`);
        announced = true;
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

export function releaseBrowserLock(): void {
  if (lockDisabled()) return;
  try {
    const owner = JSON.parse(readFileSync(OWNER, "utf8"));
    if (owner.pid === process.pid) rmSync(LOCK, { recursive: true, force: true });
  } catch { /* nothing held — already released or never taken */ }
}
