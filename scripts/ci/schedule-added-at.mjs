#!/usr/bin/env node
/**
 * WHEN DID THIS WORKFLOW'S CURRENT SCHEDULE START? (schedule-heartbeat.yml)
 *
 * The heartbeat's never-ran branch gives a workflow whose schedule is younger
 * than its budget a pass ("not yet due"): its first slot has not come round.
 * It used to date the schedule by the FIRST commit ever to add a `cron:` line
 * (`git log --reverse -S "cron:" | head -1`). eslint.yml had a cron in a file
 * created 2026-05-09 and deleted 2026-05-11 (b38d052b6); the file came back
 * with a weekly cron on 2026-10-03 (2957f7017, #2180), and the heartbeat dated
 * it to May: 147 days old, past its 8-day budget, so issue #2196 called a
 * schedule that was 10 hours old "no scheduled run ever".
 *
 * The schedule that GitHub fires is the one in the file NOW, and it started
 * at the oldest commit of the newest unbroken stretch of commits whose copy
 * of the file has an active `- cron:` line. A deletion, or a commented-out
 * cron, ends a stretch. (A rename starts a new one too, which is right: a
 * workflow's run history belongs to its path.)
 *
 *   node scripts/ci/schedule-added-at.mjs .github/workflows/<file>.yml
 *
 * Prints that commit's committer time in epoch seconds, or nothing when the
 * file has no active cron now or git cannot say (the heartbeat then reports
 * the workflow as never run: unknown is not "not yet due").
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** An active cron entry. A commented `# - cron:` line is not a schedule. */
export const ACTIVE_CRON = /^[ \t]*-[ \t]*cron:/m;

const runGit = (cwd) => (args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 24 });

/**
 * Epoch seconds of the commit that began the current stretch of `file` having
 * an active cron, or null. `git(args)` returns git's stdout (throws on error).
 */
export function scheduleAddedAt(file, { cwd = process.cwd(), git = runGit(cwd) } = {}) {
  const at = (rev) => {
    try {
      return git(["show", `${rev}:${file}`]);
    } catch {
      return null; // not in that commit (deleted, or not yet added)
    }
  };
  let log;
  try {
    // Newest first: every commit that touched the file, deletions included.
    log = git(["log", "--format=%H %ct", "--", file]).split("\n").filter(Boolean).map((l) => l.split(" "));
  } catch {
    return null;
  }
  let start = null;
  for (const [sha, ct] of log) {
    const text = at(sha);
    if (text === null || !ACTIVE_CRON.test(text)) break;
    start = Number(ct);
  }
  return start;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node scripts/ci/schedule-added-at.mjs <workflow file>");
    process.exit(2);
  }
  const t = scheduleAddedAt(file);
  if (t !== null) console.log(String(t));
}
