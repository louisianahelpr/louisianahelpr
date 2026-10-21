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
import { constants as osConstants, homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

// LH_GATE_LOCK_PATH: tests use a temp dir so they never touch the real lock.
const lockPath = () => process.env.LH_GATE_LOCK_PATH || join(homedir(), ".lh-gate.lock");
const ownerPath = () => join(lockPath(), "owner.json");

// Re-entrancy (Q135): vitest runs the root globalSetup once PER project
// (`unit` and `tz-sweep` both `extends: true`) in ONE process, so the second
// acquire used to find the lock owned by its own live pid and wait on itself
// forever. Holds are counted per process on globalThis (each project may load
// its own copy of this module) and the lock is removed on the LAST release.
const HOLDS = Symbol.for("lh.gateLock.holds");
const holds = () => globalThis[HOLDS] ?? 0;
const setHolds = (n) => {
  globalThis[HOLDS] = n;
};

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
  // LH_GATE_LOCK_HELD: a parent gateLock already holds it for this process tree.
  return !!process.env.CI || process.env.LH_GATE_LOCK === "0" || process.env.LH_GATE_LOCK_HELD === "1";
}

export async function acquireGateLock() {
  if (lockDisabled()) return;
  const LOCK = lockPath();
  const OWNER = ownerPath();
  const deadline = Date.now() + Number(process.env.LH_GATE_LOCK_WAIT_MIN ?? 30) * 60_000;
  let announced = false;
  for (;;) {
    try {
      mkdirSync(LOCK);
      writeFileSync(OWNER, JSON.stringify({ pid: process.pid, cwd: process.cwd(), at: new Date().toISOString() }));
      setHolds(1);
      return;
    } catch {
      let owner = {};
      try {
        owner = JSON.parse(readFileSync(OWNER, "utf8"));
      } catch {
        // owner file not written yet — another process is mid-acquire
      }
      if (owner.pid === process.pid) {
        // this process already holds it: re-entrant acquire, never wait on ourselves
        setHolds(holds() + 1);
        return;
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
  if (holds() > 1) {
    // an outer hold in this process is still running; the last release removes it
    setHolds(holds() - 1);
    return;
  }
  setHolds(0);
  try {
    const owner = JSON.parse(readFileSync(ownerPath(), "utf8"));
    if (owner.pid === process.pid) rmSync(lockPath(), { recursive: true, force: true });
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
    console.log(`[gate-lock] acquiring ${lockPath()}…`);
    await acquireGateLock();
    console.log("[gate-lock] acquired.");
  }
  const [cmd, ...rest] = cmdArgs;
  const child = spawn(cmd, rest, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, LH_GATE_LOCK_HELD: "1" },
  });
  // A gate killed by a timeout or Ctrl-C takes its child with it: an orphaned
  // tsc keeps the RAM (and its result) after the lock is gone.
  const forward = (sig) => () => child.kill(sig);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, forward(sig));
  const result = await new Promise((done) => {
    child.on("error", (error) => done({ status: null, signal: null, error }));
    child.on("exit", (status, signal) => done({ status, signal }));
  });
  releaseGateLock();
  const { code, message } = gateExit(result);
  if (message) console.error(message);
  process.exit(code);
}

/**
 * The gate's exit code for its child's result. Never 0 unless the child itself
 * exited 0: a child killed by a signal (the macOS memory killer, a V8 heap OOM
 * abort, a timeout) did NOT finish, so its silence is not a green run. Killed:
 * 128 + the signal number, the shell's own convention; a spawn failure: 127.
 */
export function gateExit({ status, signal, error }) {
  if (error) return { code: 127, message: `[gate-lock] could not start the command: ${error.message}. NOT a green run.` };
  if (signal) {
    const n = osConstants.signals[signal] ?? 0;
    return {
      code: 128 + n,
      message: `[gate-lock] the command was killed by ${signal} (out of memory, or stopped) and did NOT finish. NOT a green run.`,
    };
  }
  if (status === 0) return { code: 0, message: null };
  if (status === null || status === undefined) return { code: 1, message: "[gate-lock] the command ended with no exit status. NOT a green run." };
  // 134 SIGABRT / 137 SIGKILL from a shell between us and the killed process.
  if (status === 134 || status === 137) {
    return { code: status, message: `[gate-lock] the command exited ${status} (killed: out of memory, or stopped) and did NOT finish. NOT a green run.` };
  }
  return { code: status, message: null };
}

// Only run the CLI when invoked directly, not when imported (e.g. by tests).
const isDirect = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isDirect) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
