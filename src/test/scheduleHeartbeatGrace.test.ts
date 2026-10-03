/**
 * GUARD: the scheduled-workflow heartbeat gives a NEWLY scheduled workflow its
 * first chance to fire before calling it dead.
 *
 * 2026-09-23: scoreboard.yml's schedule was added at 06:07Z, its first slot is
 * 19:17Z, and the heartbeat filed nightly-red #1696 at 15:28Z for "never had a
 * schedule-triggered run". So the never-ran branch dates the schedule from git
 * and skips while it is younger than the workflow's budget.
 *
 * 2026-10-03 (issue #2196): that date was the FIRST commit ever to add a
 * `cron:` line. eslint.yml had one in a copy created 2026-05-10 and deleted
 * 2026-05-11; the file came back with a weekly cron at 2026-10-03T05:05Z
 * (#2180), and the heartbeat dated the schedule to May, 147 days old against
 * an 8-day budget: "no scheduled run ever" ten hours after it was added. The
 * class is "the grace dates a schedule by history it no longer has": a
 * deleted-and-restored file, or a cron commented out and restored (measured on
 * this repo: broken-links, edge-function-smoke, lighthouse, security-audit).
 *
 * This runs the heartbeat's OWN `ADDED=$(...)` command, taken from the
 * workflow file, in a fixture repo that replays those histories.
 *
 * @mutate .github/workflows/schedule-heartbeat.yml | if [ -n "$ADDED" ] && [ $(( (NOW - ADDED) / 86400 )) -lt "$MAX_DAYS" ]; then | if false; then
 * @mutate .github/workflows/schedule-heartbeat.yml | fetch-depth: 0 | fetch-depth: 1
 * @mutate .github/workflows/schedule-heartbeat.yml | ADDED=$(node scripts/ci/schedule-added-at.mjs ".github/workflows/$FILE") | ADDED=$(git log --reverse --format=%ct -S "cron:" -- ".github/workflows/$FILE" \| head -1)
 * @mutate scripts/ci/schedule-added-at.mjs |     if (text === null \|\| !ACTIVE_CRON.test(text)) break; |     if (text === null) break;
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const wf = readFileSync(join(ROOT, ".github/workflows/schedule-heartbeat.yml"), "utf8");

/** The never-ran branch of the heartbeat loop, up to its red count. */
function neverRanBranch(): string {
  const i = wf.indexOf('if [ -z "$LAST" ]; then');
  expect(i, "the never-ran branch is gone").toBeGreaterThan(0);
  return wf.slice(i, wf.indexOf("STALE_COUNT=$((STALE_COUNT + 1))", i));
}

/** The command the heartbeat runs to date the schedule: the body of `ADDED=$(...)`. */
function addedCommand(): string {
  const line = neverRanBranch()
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("ADDED=$("));
  expect(line, "the heartbeat no longer sets ADDED").toBeTruthy();
  return String(line).slice("ADDED=$(".length, -1);
}

const env = (date?: string) => {
  const e: Record<string, string | undefined> = {
    ...process.env,
    GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@e", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@e",
    GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0",
  };
  // A hook running this test must not point git at the real repo.
  delete e.GIT_DIR; delete e.GIT_WORK_TREE; delete e.GIT_INDEX_FILE;
  if (date) { e.GIT_AUTHOR_DATE = date; e.GIT_COMMITTER_DATE = date; }
  return e;
};
const git = (cwd: string, args: string[], date?: string) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: env(date) }).trim();

const WEEKLY = 'on:\n  schedule:\n    - cron: "30 7 * * 2"\n  workflow_dispatch:\n';
const NO_CRON = "on:\n  workflow_dispatch:\n";
const COMMENTED = 'on:\n  # schedule:\n  #   - cron: "0 9 * * 2"\n  workflow_dispatch:\n';

type Step = { at: string; body: string | null }; // null = delete the file
let root = "";

/** A fresh repo where `.github/workflows/<file>` goes through `steps`, one commit each. */
function repoWith(name: string, file: string, steps: Step[]): string {
  const dir = join(root, name);
  mkdirSync(join(dir, ".github/workflows"), { recursive: true });
  git(dir, ["init", "-q", "-b", "main"]);
  // The heartbeat runs from the repo root, where scripts/ci/ lives.
  mkdirSync(join(dir, "scripts/ci"), { recursive: true });
  copyFileSync(join(ROOT, "scripts/ci/schedule-added-at.mjs"), join(dir, "scripts/ci/schedule-added-at.mjs"));
  const path = `.github/workflows/${file}`;
  expect(steps.length, "a fixture repo with no commits proves nothing").toBeGreaterThan(0);
  for (const s of steps) {
    if (s.body === null) git(dir, ["rm", "-q", path]);
    else {
      mkdirSync(join(dir, ".github/workflows"), { recursive: true }); // git rm took the empty directory
      writeFileSync(join(dir, path), `name: ${file}\n${s.body}`);
      git(dir, ["add", path]);
    }
    git(dir, ["-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", `step ${s.at}`], s.at);
  }
  return dir;
}

/** What the heartbeat's own command prints for FILE in `dir`, as an ISO minute, or "" for nothing. */
function heartbeatAdded(dir: string, file: string): string {
  const out = execFileSync("bash", ["-c", addedCommand()], { cwd: dir, encoding: "utf8", env: { ...env(), FILE: file } }).trim();
  return out ? new Date(Number(out) * 1000).toISOString().slice(0, 16) : "";
}

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "lh-heartbeat-grace-")));
});
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("schedule heartbeat: grace for a schedule not yet due", () => {
  it("dates eslint.yml's schedule from its 2026-10-03 return, not its deleted May copy (#2196)", () => {
    // eslint.yml's real history: a1b886684 (created), b38d052b6 (deleted),
    // 2957f7017 (back with a weekly cron), ad90b5397 (edited, cron kept).
    const dir = repoWith("eslint", "eslint.yml", [
      { at: "2026-05-10T04:08:38Z", body: WEEKLY },
      { at: "2026-05-11T17:35:50Z", body: null },
      { at: "2026-10-03T05:05:57Z", body: WEEKLY },
      { at: "2026-10-03T05:06:30Z", body: `${WEEKLY}# knip note\n` },
    ]);
    expect(heartbeatAdded(dir, "eslint.yml")).toBe("2026-10-03T05:05");
  });

  it("dates a cron added to an existing workflow from the commit that added it (scoreboard, 2026-09-23)", () => {
    const dir = repoWith("scoreboard", "scoreboard.yml", [
      { at: "2026-09-01T10:00:00Z", body: NO_CRON },
      { at: "2026-09-23T06:07:00Z", body: WEEKLY },
    ]);
    expect(heartbeatAdded(dir, "scoreboard.yml")).toBe("2026-09-23T06:07");
  });

  it("dates a cron that was commented out and restored from the restore (broken-links' shape)", () => {
    const dir = repoWith("restored", "broken-links.yml", [
      { at: "2026-04-24T16:24:00Z", body: WEEKLY },
      { at: "2026-05-11T12:00:00Z", body: COMMENTED },
      { at: "2026-08-19T03:47:00Z", body: WEEKLY },
    ]);
    expect(heartbeatAdded(dir, "broken-links.yml")).toBe("2026-08-19T03:47");
  });

  it("prints nothing when the file has no active cron now, so the heartbeat reports it as never run", () => {
    const dir = repoWith("commented", "lighthouse.yml", [
      { at: "2026-04-24T16:19:00Z", body: WEEKLY },
      { at: "2026-05-10T21:17:00Z", body: COMMENTED },
    ]);
    expect(heartbeatAdded(dir, "lighthouse.yml")).toBe("");
  });

  it("skips (continue) while the schedule is younger than its budget", () => {
    const branch = neverRanBranch();
    expect(branch).toContain('if [ -n "$ADDED" ] && [ $(( (NOW - ADDED) / 86400 )) -lt "$MAX_DAYS" ]; then');
    expect(branch).toMatch(/continue/);
  });

  it("checks out full history so git log can see when the schedule was added", () => {
    expect(wf).toMatch(/fetch-depth: 0/);
  });
});
