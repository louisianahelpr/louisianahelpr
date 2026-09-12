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
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const LOCK = join(homedir(), ".lh-browser.lock");
const OWNER = join(LOCK, "owner.json");

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
      try { owner = JSON.parse(readFileSync(OWNER, "utf8")); } catch { /* owner file not written yet */ }
      if (owner.pid && !alive(owner.pid)) {
        rmSync(LOCK, { recursive: true, force: true });
        continue;
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
