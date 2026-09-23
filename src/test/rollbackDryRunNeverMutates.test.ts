/**
 * Q69: the rollback script's DRY RUN never calls a mutating API.
 *
 * scripts/rollback/rollback.mjs is the one tool that undoes prod (Vercel
 * rollback, a revert migration pushed to main, an edge-function redeploy). Its
 * default must be harmless, because the failure it guards against is someone
 * pasting a runbook line during an incident to "see what it would do".
 *
 * Method: every binary the script can call (vercel, supabase, git, npm, node)
 * is replaced by a recording shim, both on PATH and via LH_ROLLBACK_BIN_*. The
 * script then runs every path in dry-run mode, including with `--execute` but
 * WITHOUT the second switch (LH_ROLLBACK_CONFIRM). Every recorded call must be
 * on the READ allowlist below. Two-way: the reads must actually happen (the
 * shims are reached), and the live control run must reach the mutating verbs
 * (the detector can fire).
 *
 * @mutate scripts/rollback/rollback.mjs | const willRun = kind === "read" ? !OFFLINE : LIVE; | const willRun = kind === "read" ? !OFFLINE : true;
 * @mutate scripts/rollback/rollback.mjs | args.flags.execute === true && process.env.LH_ROLLBACK_CONFIRM === args.path | args.flags.execute === true
 * @mutate scripts/rollback/rollback.mjs | step("mutate", "deploy that version to prod" | step("read", "deploy that version to prod"
 */
import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(process.cwd(), "scripts/rollback/rollback.mjs");
const BINS = ["vercel", "supabase", "git", "npm", "node"];

/** Exactly the calls a dry run may make. Anything else is a mutation. */
const READS: RegExp[] = [
  /^vercel list louisianahelpr --prod\b/,
  /^vercel inspect \S+/,
  /^vercel rollback status\b/,
  /^supabase migration list --linked$/,
  /^supabase functions list\b/,
  /^git log\b/,
];
const isRead = (call: string) => READS.some((re) => re.test(call));

let dir = "";
function run(args: string[], env: Record<string, string> = {}) {
  const callLog = join(dir, "calls.log");
  const timing = join(dir, "timing.jsonl");
  rmSync(callLog, { force: true });
  rmSync(timing, { force: true });
  const binEnv = Object.fromEntries(BINS.map((b) => [`LH_ROLLBACK_BIN_${b.toUpperCase()}`, join(dir, "bin", b)]));
  const r = spawnSync(process.execPath, [SCRIPT, ...args, "--log", timing], {
    encoding: "utf8",
    env: {
      ...process.env,
      LH_ROLLBACK_CONFIRM: "",
      ...binEnv,
      PATH: `${join(dir, "bin")}:${process.env.PATH}`,
      SHIM_LOG: callLog,
      ...env,
    },
  });
  const calls = existsSync(callLog) ? readFileSync(callLog, "utf8").split("\n").filter(Boolean) : [];
  const timings = existsSync(timing) ? readFileSync(timing, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { status: r.status, out: r.stdout + r.stderr, calls, timings };
}

const migrations = readdirSync(join(process.cwd(), "supabase/migrations"))
  .filter((f) => /^\d{14}_.*\.sql$/.test(f))
  .sort();
const latestMigration = migrations[migrations.length - 1].slice(0, 14);

const DRY_CASES: string[][] = [
  ["web"],
  ["web", "--to", "https://louisianahelpr-abc123.vercel.app"],
  ["migration", "--version", latestMigration],
  ["function", "--name", "create-payment"],
  ["function", "--name", "create-payment", "--to", "deadbeef"],
  ["plan"],
];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "rollback-guard-"));
  const binDir = join(dir, "bin");
  spawnSync("mkdir", ["-p", binDir]);
  for (const b of BINS) {
    const f = join(binDir, b);
    // Record argv; answer `vercel list` / `git log` with plausible output so
    // the plan resolves real-looking targets (and the later steps run too).
    writeFileSync(
      f,
      `#!/bin/sh\necho "${b} $*" >> "$SHIM_LOG"\n` +
        `case "${b} $1" in\n` +
        `  "vercel list") echo https://louisianahelpr-now1.vercel.app; echo https://louisianahelpr-prev2.vercel.app;;\n` +
        `  "git log") echo 1111111111111111111111111111111111111111; echo 2222222222222222222222222222222222222222;;\n` +
        `esac\nexit 0\n`,
    );
    chmodSync(f, 0o755);
  }
  return () => rmSync(dir, { recursive: true, force: true });
});

describe("rollback.mjs dry run never mutates", () => {
  it("the case inventory covers every path the script offers", () => {
    const src = readFileSync(SCRIPT, "utf8");
    const offered = /const PATHS = \[([^\]]+)\]/.exec(src)![1].match(/"([a-z]+)"/g)!.map((s) => s.slice(1, -1));
    expect(offered.length).toBeGreaterThan(2);
    for (const p of offered) expect(DRY_CASES.some((c) => c[0] === p), `no dry-run case for path ${p}`).toBe(true);
  });

  for (const c of DRY_CASES) {
    // `plan --execute` is refused outright (asserted below), so it has no dry-run case here.
    for (const withExecute of c[0] === "plan" ? [false] : [false, true]) {
      const args = withExecute ? [...c, "--execute"] : c;
      it(`${args.join(" ")}: only read calls, every step timed`, () => {
        const r = run(args);
        expect(r.status, r.out).toBe(0);
        expect(r.out).toMatch(/DRY RUN/);
        const mutating = r.calls.filter((call) => !isRead(call));
        expect(mutating, `dry run invoked mutating commands:\n${mutating.join("\n")}\n---\n${r.out}`).toEqual([]);
        // Two-way: the reads really ran (the shim is reachable), and nothing
        // mutating ran even though the plan lists mutating steps.
        expect(r.calls.length).toBeGreaterThan(0);
        expect(r.out).toMatch(/\[WOULD \]/);
        const steps = r.timings.filter((t) => typeof t.step === "number");
        expect(steps.length).toBeGreaterThan(2);
        expect(steps.filter((t) => t.kind === "mutate").every((t) => t.ran === false)).toBe(true);
        expect(r.timings.some((t) => t.step === "total" && typeof t.ms === "number")).toBe(true);
      });
    }
  }

  it("--offline runs no command at all", () => {
    const r = run(["plan", "--offline"]);
    expect(r.status, r.out).toBe(0);
    expect(r.calls).toEqual([]);
  });

  it("plan refuses --execute", () => {
    const r = run(["plan", "--execute"], { LH_ROLLBACK_CONFIRM: "plan" });
    expect(r.status).toBe(2);
    expect(r.calls).toEqual([]);
  });

  it("control: with BOTH switches the live path does reach the mutating verbs (the detector can fire)", () => {
    const web = run(["web", "--execute"], { LH_ROLLBACK_CONFIRM: "web" });
    expect(web.calls.filter((c) => !isRead(c))).toEqual([
      "vercel rollback https://louisianahelpr-prev2.vercel.app --yes --scope team_UQHppAVoPIPQbyh2b43y21BG",
    ]);
    const fn = run(["function", "--name", "create-payment", "--execute"], { LH_ROLLBACK_CONFIRM: "function" });
    const fnMut = fn.calls.filter((c) => !isRead(c));
    expect(fnMut.some((c) => /^supabase functions deploy create-payment /.test(c))).toBe(true);
    expect(fnMut.some((c) => /^git worktree add --detach .* 2222222222222222222222222222222222222222$/.test(c))).toBe(true);
  });
});
