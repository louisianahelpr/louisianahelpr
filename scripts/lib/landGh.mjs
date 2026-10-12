#!/usr/bin/env node
/**
 * land.sh's GitHub calls over REST, so a landing works from every session that
 * can push (owner, 2026-10-12: "fix the bottleneck before").
 *
 * WHY. `gh pr view/create/edit/list/checks` all speak GraphQL, and Claude Code
 * cloud sessions get "HTTP 403: GitHub GraphQL is not available" on every one
 * of them (measured 2026-10-12: `gh pr view 2712 --json state` → 403, while
 * `gh api repos/.../pulls/2712` answers). land.sh read that as "GitHub did not
 * answer; asking again in a minute" and `continue`d past its own 180-minute
 * limit: PR #2672 (land/feat-signup-leads-d508f985) sat 42 h (2026-10-09 21:57
 * to 10-11 16:12, closed as superseded) while a wait loop printed that line for
 * 19 hours and never saw the PR go DIRTY.
 *
 *   node scripts/lib/landGh.mjs ensure-pr <branch> <title> <body-file>   # prints the PR number
 *   node scripts/lib/landGh.mjs auto-merge <n>          # rebase auto-merge (gh, else the session REST route)
 *   node scripts/lib/landGh.mjs queue <n>               # label land-queue, drop land-queue-failed
 *   node scripts/lib/landGh.mjs open-land-prs           # "<n> <ref> <sha>" per open land/** PR
 *   node scripts/lib/landGh.mjs close-superseded <n> <ref> <by>
 *   node scripts/lib/landGh.mjs poll <n> <waited-min> <unanswered-min>
 *       prints one verdict line: merged | closed | failed <checks> | rebase |
 *       wait | timeout <why> | unanswered (exit 0 for each; land.sh acts on it)
 *
 * Guard: src/test/landGh.test.ts (decidePoll, every verdict, and the limits).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Minutes a land PR may wait in all (a queue wait is several PRs' worth of checks). */
export const WAIT_LIMIT_MIN = 180;
/** Minutes in a row GitHub may fail to answer before the wait stops red (never forever again). */
export const UNANSWERED_LIMIT_MIN = 10;

/**
 * Pure. One minute of land.sh's wait.
 *   status: null when GitHub did not answer, else
 *     { state: "open"|"closed", merged: bool, mergeable_state: string|null, failed: string[] }
 *   waited: minutes waited so far (this one included); unanswered: minutes in a row without an answer;
 * BEHIND stays a wait: it is the land queue's to bring up to date, one head at
 * a time (scripts/land-queue.mjs); a local rebase would jump the queue and
 * restart checks the queue is about to restart anyway.
 */
export function decidePoll({ status, waited, unanswered }) {
  if (!status) {
    if (unanswered >= UNANSWERED_LIMIT_MIN) return { verdict: "timeout", why: `GitHub did not answer for ${unanswered} min in a row` };
    if (waited >= WAIT_LIMIT_MIN) return { verdict: "timeout", why: `not merged after ${waited} min` };
    return { verdict: "unanswered" };
  }
  if (status.merged) return { verdict: "merged" };
  if (status.state === "closed") return { verdict: "closed" };
  if (status.failed.length) return { verdict: "failed", checks: status.failed };
  // A conflict the queue cannot resolve (it passes DIRTY over): rebase here, now.
  if (status.mergeable_state === "dirty") return { verdict: "rebase", why: "conflicts with main" };
  if (waited >= WAIT_LIMIT_MIN) return { verdict: "timeout", why: `not merged after ${waited} min` };
  return { verdict: "wait" };
}

/** owner/repo from origin's URL (github.com or a proxy path ending in owner/repo). */
export function repoSlug(url) {
  const m = /[/:]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(String(url).trim());
  if (!m) throw new Error(`cannot read owner/repo from origin URL ${url}`);
  return `${m[1]}/${m[2]}`;
}

/** Latest run per check name; failed = a required one that concluded red. Pure. */
export function failedRequired(checkRuns, required) {
  const latest = new Map();
  for (const r of checkRuns) {
    const prev = latest.get(r.name);
    if (!prev || r.id > prev.id) latest.set(r.name, r);
  }
  const RED = new Set(["failure", "cancelled", "timed_out", "action_required", "startup_failure"]);
  return required.filter((n) => RED.has(latest.get(n)?.conclusion ?? "")).sort();
}

function sh(cmd, args, input) {
  return execFileSync(cmd, args, { encoding: "utf8", input, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"], maxBuffer: 1 << 26 });
}
const SLUG = () => repoSlug(sh("git", ["remote", "get-url", "origin"]));
const api = (path, ...extra) => JSON.parse(sh("gh", ["api", ...extra, `repos/${SLUG()}/${path}`]) || "null");

function requiredNames() {
  const rules = api("rules/branches/main");
  return [...new Set(rules.filter((r) => r.type === "required_status_checks").flatMap((r) => r.parameters.required_status_checks.map((c) => c.context)))];
}

function status(n) {
  const pr = api(`pulls/${n}`);
  let failed = [];
  if (pr.state === "open") {
    const runs = [];
    for (let page = 1; page <= 5; page++) {
      const r = api(`commits/${pr.head.sha}/check-runs?per_page=100&page=${page}`);
      runs.push(...r.check_runs);
      if (r.check_runs.length < 100) break;
    }
    failed = failedRequired(runs, requiredNames());
  }
  return { state: pr.state, merged: Boolean(pr.merged), mergeable_state: pr.mergeable_state ?? null, failed };
}

function ensurePr(branch, title, bodyFile) {
  const owner = SLUG().split("/")[0];
  const open = api(`pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`);
  if (open.length) return open[0].number;
  const body = JSON.stringify({ base: "main", head: branch, title, body: readFileSync(bodyFile, "utf8") });
  return JSON.parse(sh("gh", ["api", "-X", "POST", `repos/${SLUG()}/pulls`, "--input", "-"], body)).number;
}

function autoMerge(n) {
  try {
    sh("gh", ["pr", "merge", String(n), "--rebase", "--auto"]);
    return "gh";
  } catch (e) {
    // GraphQL refused (cloud session): the session's REST route for auto-merge.
    sh("gh", ["api", "-X", "PUT", `repos/${SLUG()}/pulls/${n}/ccr/auto_merge`, "-f", "merge_method=rebase"]);
    return `rest (gh said: ${String(e.stderr ?? e.message).trim().split("\n")[0].slice(0, 120)})`;
  }
}

function queue(n) {
  try { sh("gh", ["api", "-X", "DELETE", `repos/${SLUG()}/issues/${n}/labels/land-queue-failed`]); } catch { /* not labelled: nothing to drop */ }
  sh("gh", ["api", "-X", "POST", `repos/${SLUG()}/issues/${n}/labels`, "-f", "labels[]=land-queue"]);
}

function main(argv) {
  const [cmd, ...a] = argv;
  switch (cmd) {
    case "ensure-pr":
      console.log(ensurePr(a[0], a[1], a[2]));
      return;
    case "auto-merge":
      console.log(`land: auto-merge (rebase) on via ${autoMerge(a[0])}.`);
      return;
    case "queue":
      queue(a[0]);
      return;
    case "open-land-prs":
      // Every page (Q1693: a set read is read whole; one page is the newest 100).
      for (const p of api("pulls?state=open&per_page=100", "--paginate", "--slurp").flat()) if (p.head.ref.startsWith("land/")) console.log(`${p.number} ${p.head.ref} ${p.head.sha}`);
      return;
    case "close-superseded": {
      const [n, ref, by] = a;
      sh("gh", ["api", "-X", "POST", `repos/${SLUG()}/issues/${n}/comments`, "-f", `body=Superseded by ${by} (its commits are already in that head).`]);
      sh("gh", ["api", "-X", "PATCH", `repos/${SLUG()}/pulls/${n}`, "-f", "state=closed"]);
      try { sh("gh", ["api", "-X", "DELETE", `repos/${SLUG()}/git/refs/heads/${ref}`]); } catch { /* already gone */ }
      return;
    }
    case "poll": {
      const [n, waited, unanswered] = a;
      let s = null;
      let err = "";
      try { s = status(n); } catch (e) { err = String(e.stderr ?? e.message).trim().split("\n")[0].slice(0, 200); }
      const d = decidePoll({ status: s, waited: Number(waited), unanswered: Number(unanswered) + (s ? 0 : 1) });
      const extra = d.checks ? d.checks.join(", ") : d.why ?? "";
      // The mergeable state rides along for land.sh's log line.
      console.log([d.verdict, s?.mergeable_state ?? "-", extra || err].filter((x) => x !== "").join("\t"));
      return;
    }
    default:
      console.error(`landGh: unknown command ${cmd}`);
      process.exit(2);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main(process.argv.slice(2));
