import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";

/**
 * scripts/check-changed.mjs (2026-09-12): skipping the pre-push visual sweep
 * via LH_SKIP_CHANGED_CHECK=1 must never be invisible — every skip is logged
 * to docs/audit/prepush-skips.log, and a skip with no LH_SKIP_REASON fails
 * the push instead of passing silently.
 *
 * This test drives the real script as a subprocess (it exits before
 * touching Playwright when skipping) and restores the log to its prior
 * state afterward so running the suite repeatedly doesn't pollute it.
 */

const REPO_ROOT = resolve(__dirname, "..", "..");
const LOG_PATH = resolve(REPO_ROOT, "docs", "audit", "prepush-skips.log");
const SCRIPT_PATH = resolve(REPO_ROOT, "scripts", "check-changed.mjs");

// date | branch=... | sha=... | reason=...
const LOG_LINE_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \| branch=\S+ \| sha=\S+ \| reason=.+$/;

function readLogLines(): string[] {
  if (!existsSync(LOG_PATH)) return [];
  const content = readFileSync(LOG_PATH, "utf8");
  return content.length ? content.split("\n").filter(Boolean) : [];
}

function runScript(env: Record<string, string | undefined>) {
  try {
    execFileSync("node", [SCRIPT_PATH], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env },
      stdio: "pipe",
    });
    return 0;
  } catch (err) {
    const e = err as { status?: number };
    return e.status ?? 1;
  }
}

// @mutate scripts/check-changed.mjs | );\n    process.exit(1);\n  }\n  logSkip(reason); | );\n    process.exit(0);\n  }\n  logSkip(reason);
// @mutate scripts/check-changed.mjs | appendFileSync(SKIP_LOG, line); |

describe("scripts/check-changed.mjs skip logging", () => {
  it("every existing log line matches the required format", () => {
    // WHY THIS TEST MAKES ITS OWN CORPUS. docs/audit/prepush-skips.log is
    // GITIGNORED. In a fresh worktree the file does not exist, readLogLines()
    // returns [], and this loop asserted nothing while reporting green — which
    // is how a genuinely malformed line stayed invisible AND how a "is this
    // pre-existing?" worktree check gave a false answer (2026-09-19).
    //
    // An empty inventory passes every per-member assertion. So: drive the real
    // script once to guarantee at least one line exists, assert the FLOOR
    // before the loop, then restore the log to its prior state.
    const before = readLogLines();
    const status = runScript({
      LH_SKIP_CHANGED_CHECK: "1",
      LH_SKIP_REASON: "vitest prepushSkipsLog format corpus",
    });
    expect(status).toBe(0);

    const lines = readLogLines();
    expect(lines.length).toBeGreaterThan(before.length);
    for (const line of lines) {
      expect(line).toMatch(LOG_LINE_RE);
    }

    mkdirSync(dirname(LOG_PATH), { recursive: true });
    if (before.length) {
      writeFileSync(LOG_PATH, before.join("\n") + "\n");
    } else {
      rmSync(LOG_PATH, { force: true });
    }
  });

  it("fails the push and does not log when LH_SKIP_REASON is missing", () => {
    const before = readLogLines();
    const status = runScript({ LH_SKIP_CHANGED_CHECK: "1", LH_SKIP_REASON: undefined });
    expect(status).not.toBe(0);
    expect(readLogLines()).toEqual(before);
  });

  it("logs one well-formed line and exits 0 when a reason is given", () => {
    const before = readLogLines();
    const reason = "vitest prepushSkipsLog format check";
    const status = runScript({ LH_SKIP_CHANGED_CHECK: "1", LH_SKIP_REASON: reason });
    expect(status).toBe(0);

    const after = readLogLines();
    expect(after.length).toBe(before.length + 1);
    const appended = after[after.length - 1];
    expect(appended).toMatch(LOG_LINE_RE);
    expect(appended).toContain(`reason=${reason}`);

    // Restore the log to its prior state so repeated test runs (and CI)
    // don't accumulate synthetic entries.
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    if (before.length) {
      writeFileSync(LOG_PATH, before.join("\n") + "\n");
    } else {
      rmSync(LOG_PATH, { force: true });
    }
  });
});
