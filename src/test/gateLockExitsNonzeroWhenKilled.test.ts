/**
 * A gated run that did not finish is never a green run (lead, 2026-10-21:
 * "gateLock exits 0 when typecheck runs out of memory, so a gated green can
 * be false"). On this 8 GB Mac `tsc -b` regularly dies of a V8 heap OOM
 * (SIGABRT) or the macOS memory killer (SIGKILL); whatever ran the gate must
 * see a nonzero exit and a line saying the run did NOT finish.
 *
 * The class is "a child that ended without exiting 0": every way it can end
 * is run for real below, through the gate's own CLI (each case is a real
 * process: killed, aborted, out of heap, behind a shell, never started).
 *
 * Note: `gate ... | tail` reports TAIL's exit code; read the gate's own line.
 */
// @mutate scripts/gateLock.mjs |   if (signal) { |   if (false) {
// @mutate scripts/gateLock.mjs |   if (status === 134 \|\| status === 137) { |   if (false) {
// @mutate scripts/gateLock.mjs |   if (error) return { code: 127, | if (error) return { code: 0,
// @mutate scripts/gateLock.mjs |   process.exit(code); |   process.exit(0);
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { gateExit } from "../../scripts/gateLock.mjs";

const dir = mkdtempSync(join(tmpdir(), "lh-gate-kill-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function gate(...cmd: string[]) {
  const r = spawnSync(process.execPath, ["scripts/gateLock.mjs", "--", ...cmd], {
    encoding: "utf8",
    timeout: 60_000,
    // never the real ~/.lh-gate.lock; CI unset so the lock path is exercised too
    env: { ...process.env, CI: "", LH_GATE_LOCK: "", LH_GATE_LOCK_HELD: "", LH_GATE_LOCK_PATH: join(dir, "lock") },
  });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}

const node = process.execPath;
const CASES: Array<[string, string[]]> = [
  ["killed by SIGKILL (the macOS memory killer)", [node, "-e", "process.kill(process.pid, 'SIGKILL')"]],
  ["aborted (a V8 fatal error)", [node, "-e", "process.abort()"]],
  ["out of heap (tsc -b on this Mac)", [node, "--max-old-space-size=16", "-e", "const a = []; for (;;) a.push(new Array(1e5).fill(1));"]],
  ["killed behind a shell (npm run, sh -c)", ["sh", "-c", `"${node}" -e "process.kill(process.pid, 'SIGKILL')"`]],
  ["killed by SIGTERM (a timeout)", [node, "-e", "process.kill(process.pid, 'SIGTERM')"]],
  ["never started", ["/nonexistent/lh-no-such-command"]],
];

describe("gateLock never reports a run that did not finish as green", () => {
  it("the inventory of ways a child can end without exiting 0 is covered", () => {
    expect(CASES.length).toBeGreaterThan(4);
  });

  for (const [why, cmd] of CASES) {
    it(`exits nonzero and says so when the command is ${why}`, () => {
      const r = gate(...cmd);
      expect(r.status, r.out).not.toBe(0);
      expect(r.status, r.out).not.toBeNull();
      expect(r.out).toMatch(/NOT a green run/);
    }, 60_000);
  }

  it("passes a finished command's own exit code through unchanged", () => {
    expect(gate(node, "-e", "process.exit(0)").status).toBe(0);
    const failed = gate(node, "-e", "process.exit(3)");
    expect(failed.status).toBe(3);
    expect(failed.out).not.toMatch(/NOT a green run/);
  }, 60_000);

  it("maps a signal to 128 + its number, the shell's convention", () => {
    expect(gateExit({ status: null, signal: "SIGKILL" }).code).toBe(137);
    expect(gateExit({ status: null, signal: "SIGABRT" }).code).toBe(134);
    expect(gateExit({ status: null, signal: null }).code).toBe(1);
    expect(gateExit({ status: 0, signal: null })).toEqual({ code: 0, message: null });
  });
});
