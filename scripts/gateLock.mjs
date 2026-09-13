#!/usr/bin/env node
/**
 * One `npm run typecheck` / `npm run test:unit` at a time across every local
 * checkout (owner, 2026-09-12). CLAUDE.md already documents "vitest run is
 * NOT trustworthy while several agents share this tree" — parallel lanes
 * running tsc/vitest at once starve each other's CPU/IO and produce a
 * varying set of spurious `findBy*` timeouts. This is the same fix as
 * e2e/browserLock.ts, applied to the compile/test gate instead of the
 * browser.
 *
 * Usage: node scripts/gateLock.mjs -- <command> [args...]
 *   node scripts/gateLock.mjs -- npm run typecheck
 *   node scripts/gateLock.mjs -- npx vitest run
 *
 * `mkdir` is atomic, so two runs cannot both take the lock. A lock whose
 * owner pid is dead is stale and is taken over. Waits up to
 * LH_GATE_LOCK_WAIT_MIN (default 30) minutes. Skipped in CI, where each job
 * has its own machine. LH_GATE_LOCK=0 bypasses.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const LOCK = join(homedir(), ".lh-gate.lock");
const OWNER = join(LOCK, "owner.json");

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    // ESRCH: that pid has exited, so its lock is stale
    return false;
  }
}

export function lockDisabled() {
  return !!process.env.CI || process.env.LH_GATE_LOCK === "0";
}

export async function acquireGateLock() {
  if (lockDisabled()) return;
  const deadline = Date.now() + Number(process.env.LH_GATE_LOCK_WAIT_MIN ?? 30) * 60_000;
  let announced = false;
  for (;;) {
    try {
      mkdirSync(LOCK);
      writeFileSync(OWNER, JSON.stringify({ pid: process.pid, cwd: process.cwd(), at: new Date().toISOString() }));
      return;
    } catch {
      let owner = {};
      try {
        owner = JSON.parse(readFileSync(OWNER, "utf8"));
      } catch {
        // owner file not written yet — another process is mid-acquire
      }
      if (owner.pid && !alive(owner.pid)) {
        rmSync(LOCK, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(`Gate lock ${LOCK} held by pid ${owner.pid} (${owner.cwd}) past the wait limit.`);
      }
      if (!announced) {
        console.log(`[gate-lock] waiting for pid ${owner.pid} in ${owner.cwd} to finish its typecheck/test run…`);
        announced = true;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

export function releaseGateLock() {
  if (lockDisabled()) return;
  try {
    const owner = JSON.parse(readFileSync(OWNER, "utf8"));
    if (owner.pid === process.pid) rmSync(LOCK, { recursive: true, force: true });
  } catch {
    // nothing held — already released or never taken
  }
}

async function main() {
  const sepIndex = process.argv.indexOf("--");
  const cmdArgs = sepIndex === -1 ? process.argv.slice(2) : process.argv.slice(sepIndex + 1);
  if (!cmdArgs.length) {
    console.error("Usage: node scripts/gateLock.mjs -- <command> [args...]");
    process.exit(1);
  }
  if (lockDisabled()) {
    console.log("[gate-lock] disabled (CI or LH_GATE_LOCK=0) — running without the lock.");
  } else {
    console.log(`[gate-lock] acquiring ${LOCK}…`);
    await acquireGateLock();
    console.log("[gate-lock] acquired.");
  }
  const [cmd, ...rest] = cmdArgs;
  const result = spawnSync(cmd, rest, { stdio: "inherit", shell: process.platform === "win32" });
  releaseGateLock();
  process.exit(result.status ?? 1);
}

// Only run the CLI when invoked directly, not when imported (e.g. by tests).
const isDirect = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isDirect) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
