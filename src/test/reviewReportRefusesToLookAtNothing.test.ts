/**
 * `npm run review:report` must FAIL when it has looked at nothing.
 *
 * ─── THE DEFECT ────────────────────────────────────────────────────────────
 *
 * CLAUDE.md: "'I looked' is RECORDED, not claimed." `scripts/review-report.mjs`
 * is the enforcement of that sentence, and until 2026-09-19 it could be
 * satisfied by an empty room:
 *
 *   - it scanned exactly two directories, `test-results/` and
 *     `SWEEP_OUTPUT_DIR` (default `/tmp/ui-review`). A run that captured
 *     anywhere else — `a11y-webkit-prod.yml` points SWEEP_OUTPUT_DIR at
 *     `$GITHUB_WORKSPACE/a11y-prod-out/<engine>`, `check-changed.mjs` at
 *     `test-results/check-changed` — printed "(no screenshots found)" and
 *     **exited 0**;
 *   - a default run on 2026-09-19 listed 72 unreviewed captures left by a
 *     previous lane, reported "0 reviewed", and **exited 0**;
 *   - `/tmp` is age-wiped here, so evidence disappears and the disappearance
 *     also read as a pass.
 *
 * A reporter that exits 0 having looked at nothing certifies nothing. That is
 * the vacuous-check class this repo spent the day removing, sitting inside the
 * tool built to catch it — so it gets the same treatment as any other guard:
 * an inventory it must actually find, and a proof it can go red.
 *
 * ─── WHAT THIS TEST DRIVES ─────────────────────────────────────────────────
 *
 * The real script, as a child process, against throwaway directories — not a
 * re-implementation of its logic, which could agree with a broken script.
 * Every root it consults is pinned through the environment so the machine's
 * own `/tmp/ui-review` cannot leak in and make a case pass by accident.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(__dirname, "..", "..", "scripts", "review-report.mjs");

type Run = { code: number; out: string };

/** Run the real script in a throwaway cwd with every root pinned. */
function run(cwd: string, env: Record<string, string> = {}, args: string[] = []): Run {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      // An empty, EXISTING sweep dir: the machine's real /tmp/ui-review must
      // never decide the outcome of a case about an empty run.
      env: { ...process.env, SWEEP_OUTPUT_DIR: join(cwd, "sweep-empty"), REVIEW_DIRS: "", ...env },
    });
    return { code: 0, out };
  } catch (e: any) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

function sandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), "review-report-"));
  mkdirSync(join(dir, "sweep-empty"), { recursive: true });
  mkdirSync(join(dir, "test-results"), { recursive: true });
  return dir;
}

const png = (p: string) => {
  mkdirSync(resolve(p, ".."), { recursive: true });
  // A 1x1 PNG header is enough — the script keys on the extension, not pixels.
  writeFileSync(p, Buffer.from("89504e470d0a1a0a", "hex"));
  return p;
};

const record = (cwd: string, screenshot: string, verdict = "ok") =>
  appendFileSync(
    join(cwd, "test-results", "review-log.jsonl"),
    JSON.stringify({ screenshot: resolve(screenshot), screen: "s", checked: "c", verdict }) + "\n",
  );

describe("review:report refuses to pass having looked at nothing", () => {
  it("FAILS on an empty world — the exact hole: nothing found, exit 0", () => {
    const cwd = sandbox();
    try {
      const r = run(cwd);
      // This is the assertion the old script could not satisfy. It printed
      // "(no screenshots found)" here and returned 0.
      expect(r.code, r.out).toBe(1);
      expect(r.out).toMatch(/no screenshots under any root and no review entries/);
      expect(r.out).toMatch(/certifies nothing/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("FAILS when captures exist and the log is empty — '0 reviewed' is the finding", () => {
    const cwd = sandbox();
    try {
      png(join(cwd, "test-results", "a.png"));
      png(join(cwd, "test-results", "b.png"));
      const r = run(cwd);
      expect(r.code, r.out).toBe(1);
      expect(r.out).toMatch(/2 screenshot\(s\) found and the review log is EMPTY/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("FAILS when every recorded review points at a file that is gone (/tmp age-wipe)", () => {
    const cwd = sandbox();
    try {
      png(join(cwd, "test-results", "survivor.png"));
      record(cwd, join(cwd, "test-results", "survivor.png"));
      record(cwd, join(cwd, "wiped", "gone.png"));
      // One survives, so this passes the "all gone" gate …
      expect(run(cwd).code).toBe(0);
      // … and with the survivor gone too, the whole claim is unverifiable.
      rmSync(join(cwd, "test-results", "survivor.png"));
      const r = run(cwd);
      expect(r.code, r.out).toBe(1);
      expect(r.out).toMatch(/the evidence is gone/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("still FAILS an unreviewed failure/changed capture — the original rule", () => {
    const cwd = sandbox();
    try {
      png(join(cwd, "test-results", "ok.png"));
      record(cwd, join(cwd, "test-results", "ok.png"));
      png(join(cwd, "test-results", "shot-diff.png"));
      const r = run(cwd);
      expect(r.code, r.out).toBe(1);
      expect(r.out).toMatch(/1 failure\/changed screenshot\(s\) have no review entry/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("PASSES a real, fully reviewed run — the guard is not simply always red", () => {
    const cwd = sandbox();
    try {
      png(join(cwd, "test-results", "shot-diff.png"));
      record(cwd, join(cwd, "test-results", "shot-diff.png"));
      const r = run(cwd);
      expect(r.code, r.out).toBe(0);
      expect(r.out).toMatch(/1 screenshot\(s\), 1 reviewed/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("review:report accounts for captures outside its default root", () => {
  it("adopts every directory the LOG itself names, and counts what is there", () => {
    const cwd = sandbox();
    try {
      // The out-of-root capture: not under test-results/, not under
      // SWEEP_OUTPUT_DIR. The old script could not see this file at all.
      const far = png(join(cwd, "a11y-prod-out", "webkit", "browse-375.png"));
      png(join(cwd, "a11y-prod-out", "webkit", "browse-1440-diff.png"));
      record(cwd, far);
      const r = run(cwd);
      expect(r.out).toMatch(/roots scanned:/);
      expect(r.out).toContain(join(cwd, "a11y-prod-out", "webkit"));
      // Both files under that root are now in the report …
      expect(r.out).toMatch(/2 screenshot\(s\), 1 reviewed/);
      // … and the unreviewed -diff there is caught, which is the point of
      // seeing the directory at all.
      expect(r.code, r.out).toBe(1);
      expect(r.out).toMatch(/1 failure\/changed screenshot\(s\) have no review entry/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("takes an explicit root from argv and from REVIEW_DIRS — the case the log cannot reveal", () => {
    const cwd = sandbox();
    try {
      // Captured elsewhere and recorded NOWHERE: the log has nothing to point
      // with, so an operator must be able to point instead.
      png(join(cwd, "elsewhere", "x-diff.png"));
      const byArg = run(cwd, {}, [join(cwd, "elsewhere")]);
      expect(byArg.out).toContain(join(cwd, "elsewhere"));
      expect(byArg.code, byArg.out).toBe(1);

      const byEnv = run(cwd, { REVIEW_DIRS: join(cwd, "elsewhere") });
      expect(byEnv.out).toContain(join(cwd, "elsewhere"));
      expect(byEnv.code, byEnv.out).toBe(1);

      // and without being pointed, that directory is simply not there — which
      // is exactly why the empty result must fail rather than pass.
      const blind = run(cwd);
      expect(blind.out).not.toContain(join(cwd, "elsewhere", "x-diff.png"));
      expect(blind.code, blind.out).toBe(1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("names every root it scanned, so 'I scanned nothing' is visible in the output", () => {
    const cwd = sandbox();
    try {
      const r = run(cwd);
      expect(r.out).toMatch(/roots scanned:/);
      expect(r.out).toContain(join(cwd, "test-results"));
      expect(r.out).toContain(join(cwd, "sweep-empty"));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

/*
 * @mutate scripts/review-report.mjs | if (shots.length === 0 && reviews.length === 0) { | if (false) {
 * @mutate scripts/review-report.mjs | ...reviews.map((r) => canon(dirname(resolve(r.screenshot)))), |
 */
