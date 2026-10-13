/**
 * CLASS GUARD: no GitHub API call per item of a list (branches, PRs, runs,
 * claims), unless it is listed below as bounded, with why.
 *
 * The owner's GitHub token is shared: every workflow that runs on
 * REFRESH_PR_TOKEN and every local `gh` call (the lead, the lanes, land.sh)
 * draw on ONE 5000-request hour. It ran out on 2026-10-12 (an agent's
 * stranded-work --remote scan) and again at 01:44Z on 2026-10-13, which turned
 * open-auto-tick run 38333338888 red with "API rate limit exceeded". The
 * second time it was scripts/prune-stale-claims.mjs: three REST calls PER claim
 * branch (commits/<sha>, activity?ref=, compare/main...<sha>), ~130 claims,
 * 395 calls a run (measured with a counting gh wrapper), polled every 2 min by
 * a local waiter, about 100 calls a minute (X-RateLimit-Used 441 -> 779 from
 * 01:52:39Z to 01:55:40Z). It now reads git plus one paginated activity read:
 * 16 calls a run, the same 131 decisions.
 *
 * What counts as a per-item call, read from the source (comments blanked):
 *   JS (scripts/**, .mjs/.js/.cjs/.ts): a call that runs gh (execFileSync /
 *   execSync / spawnSync / sh / exec with "gh", or a local wrapper whose
 *   one-line body does) lexically inside a loop: a `for` / `while` statement
 *   or a `.map / .forEach / .flatMap / .filter / .some / .every / .reduce`
 *   callback.
 *   Shell (scripts/**.sh, .github/** workflow and action YAML): a line running
 *   `gh ` between a `for`/`while`/`until` and its `done`.
 * Each hit must be in BOUNDED (exact both ways), keyed `file: first 60 chars
 * of the call's line, trimmed`, with why it cannot grow with a list.
 */
// @mutate scripts/land-queue.mjs |   if (budget && budget.remaining < BUDGET_FLOOR) { |   if (false) {
// @mutate .github/actions/refresh-pr/action.yml |         if ! BUDGET=$(node scripts/lib/ghBudget.mjs); then |         if ! BUDGET=$(true); then
// @mutate scripts/prune-stale-claims.mjs |     tipDate: git(["show", "-s", "--format=%cI", sha]), |     tipDate: api(`repos/{owner}/{repo}/commits/${sha}`, ".commit.committer.date"),
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankHashComments } from "./helpers/blankNonCode";
import { BUDGET_FLOOR, parseRateHeaders } from "../../scripts/lib/ghBudget.mjs";

const ROOT = join(__dirname, "..", "..");
const tracked = execFileSync("git", ["ls-files", "-z", "--", "scripts", ".github"], { cwd: ROOT, encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const jsFiles = tracked.filter((f) => f.startsWith("scripts/") && /\.(mjs|cjs|js|ts)$/.test(f) && !/\.d\.m?ts$/.test(f));
const shellFiles = tracked.filter((f) => (f.startsWith("scripts/") && /\.(sh|bash)$/.test(f)) || (f.startsWith(".github/") && /\.ya?ml$/.test(f)));

const LOOP_CALLBACK = /\.(map|forEach|flatMap|filter|some|every|reduce|find)\s*$/;

/** Names of local functions whose one-line body runs gh: `const api = (..) => execFileSync("gh", ...)`. */
function ghWrappers(src: string): string[] {
  const names = new Set<string>();
  for (const m of src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>[^\n]*\b(?:execFileSync|execSync|spawnSync|exec|sh)\(\s*["'`]gh["'`]/g)) names.add(m[1]);
  for (const m of src.matchAll(/function\s+(\w+)\s*\([^)]*\)\s*\{[^}]{0,200}?\b(?:execFileSync|execSync|spawnSync|exec|sh)\(\s*["'`]gh["'`]/g)) names.add(m[1]);
  // A gh runner passed in as a parameter (stranded-work.mjs: `gh = defaultGh`)
  // or named for what it is: in a file that runs gh, these names are gh calls.
  for (const n of ["gh", "ghJson", "ghApi", "api", "apiPaged"]) names.add(n);
  return [...names];
}

/** Is offset `at` inside a loop: an enclosing for/while block or a loop-callback paren? */
function insideLoop(src: string, at: number): boolean {
  let depth = 0;
  for (let i = at - 1; i >= 0; i--) {
    const c = src[i];
    if (c === ")" || c === "}" || c === "]") depth++;
    else if (c === "(" || c === "{" || c === "[") {
      if (depth > 0) { depth--; continue; }
      const before = src.slice(Math.max(0, i - 200), i).replace(/\s+$/, "");
      if (c === "(" && LOOP_CALLBACK.test(before)) return true;
      if (c === "(" && /\b(for|while)\s*$/.test(before)) return true;
      if (c === "{" && /\b(for|while)\s*\([^{};]*\)$/.test(before.replace(/\n/g, " "))) return true;
      if (c === "{" && /\bdo$/.test(before)) return true;
    }
  }
  // A brace-less `for (...) call(...)` on the call's own line.
  const lineStart = src.lastIndexOf("\n", at) + 1;
  return /^\s*for\s*\(.*\)\s*[^{]*$/.test(src.slice(lineStart, at));
}

const key = (file: string, src: string, at: number) => {
  const lineStart = src.lastIndexOf("\n", at) + 1;
  const lineEnd = src.indexOf("\n", at);
  return `${file}: ${src.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim().slice(0, 60)}`;
};

function jsHits(): string[] {
  const out = new Set<string>();
  for (const f of jsFiles) {
    const src = blankComments(readFileSync(join(ROOT, f), "utf8"));
    if (!/["'`]gh["'`]/.test(src)) continue;
    const callRes = [/\b(?:execFileSync|execSync|spawnSync|exec|sh)\(\s*["'`]gh["'`]/g];
    const wrappers = ghWrappers(src);
    if (wrappers.length) callRes.push(new RegExp(`(?<![.\\w])(?:${wrappers.join("|")})\\(`, "g"));
    for (const re of callRes) {
      for (const m of src.matchAll(re)) {
        // The wrapper's own definition line is not a call site.
        const lineStart = src.lastIndexOf("\n", m.index!) + 1;
        if (/^\s*(?:const|let|function)\s/.test(src.slice(lineStart, m.index!)) && /=>|function/.test(src.slice(lineStart, m.index! + 40))) {
          if (wrappers.some((w) => new RegExp(`(?:const|let|function)\\s+${w}\\b`).test(src.slice(lineStart, m.index!)))) continue;
        }
        if (insideLoop(src, m.index!)) out.add(key(f, src, m.index!));
      }
    }
  }
  return [...out].sort();
}

function shellHits(): string[] {
  const out = new Set<string>();
  for (const f of shellFiles) {
    const lines = blankHashComments(readFileSync(join(ROOT, f), "utf8")).split("\n");
    let depth = 0;
    for (const [i, line] of lines.entries()) {
      const t = line.trim();
      // A shell loop opens with `do` on its own line or the next one; a Python
      // heredoc's `for x in y:` (prod-freshness.yml) has none and is not one.
      const next = (lines[i + 1] ?? "").trim();
      const opens =
        (t.match(/(^|[;&|]\s*|\bthen\s+)(for|while|until)\s[^;]*;\s*do\b/g) ?? []).length ||
        (/^(for|while|until)\s/.test(t) && (/\bdo$/.test(t) || /^do\b/.test(next)) ? 1 : 0);
      const callsGh = /(^|[\s;&|(`$])gh\s+(api|pr|run|issue|workflow|release|label|repo|search)\b/.test(t);
      if (callsGh && (depth > 0 || (opens > 0 && /\bdo\b/.test(t) && t.indexOf("gh ") > t.indexOf(" do")))) out.add(`${f}: ${t.slice(0, 60)}`);
      depth += opens;
      depth -= (t.match(/(^|[;&|]\s*)done\b/g) ?? []).length;
      if (depth < 0) depth = 0;
    }
  }
  return [...out].sort();
}

/** Per-item gh calls that cannot grow with a list, each with why. EXACT both ways. */
// @two-way src/test/ghCallsNotPerItem.test.ts:a BOUNDED entry that no longer matches a per-item call
const BOUNDED: Record<string, string> = {
  ".github/actions/refresh-pr/action.yml: gh workflow run \"$wf\" --repo \"$GITHUB_REPOSITORY\" --ref \"$BR":
    "one dispatch per CHECK_WORKFLOWS entry (4 required-check workflows), once per refresh",
  ".github/workflows/functions-deploy.yml: RUN=$(gh api \"repos/${GITHUB_REPOSITORY}/actions/workflows/d":
    "GITHUB_TOKEN; polls the one db-deploy run of this commit until its elapsed limit",
  ".github/workflows/nightly-red-age.yml: gh issue list --repo \"${{ github.repository }}\" --label \"$LA":
    "GITHUB_TOKEN; one list per alert label (nightly-red, prod-down)",
  ".github/workflows/nightly-red-rerun.yml: STATUS=$(gh api \"repos/${REPO}/actions/runs/${RUN_ID}\" --jq ":
    "GITHUB_TOKEN; polls one run, at most 80 times",
  ".github/workflows/schedule-heartbeat.yml: LAST=$(gh api \"repos/$REPO/actions/workflows/$FILE/runs?even":
    "GITHUB_TOKEN; one read per WATCHED scheduled workflow (~42), once per heartbeat",
  ".github/workflows/schedule-heartbeat.yml: STATE=$(gh api \"repos/$REPO/actions/workflows/$FILE\" --jq '.":
    "GITHUB_TOKEN; one read per WATCHED scheduled workflow (~42), once per heartbeat",
  "scripts/ci/cancelled-prod-load-runs.mjs: if (!dryRun) execFileSync(\"gh\", args, { encoding: \"utf8\", st":
    "GITHUB_TOKEN (schedule-heartbeat); one re-dispatch per prod-load workflow with a stalled run",
  "scripts/ci/cancelled-prod-load-runs.mjs: try { annotations[j.id] = ghJson([\"api\", `repos/${repo}/chec":
    "GITHUB_TOKEN; one read per CANCELLED job of a stalled prod-load run",
  "scripts/ci/main-batch.mjs: changedFiles = JSON.parse(gh([\"api\", `repos/${repo}/compare/":
    "GITHUB_TOKEN; one compare per main-batch TARGET (fixed list)",
  "scripts/ci/main-batch.mjs: const runs = JSON.parse(gh([\"api\", `repos/${repo}/actions/wo":
    "GITHUB_TOKEN; one list per main-batch TARGET (fixed list)",
  "scripts/ci/main-batch.mjs: if (d.action === \"dispatch\") gh([\"workflow\", \"run\", t.file, ":
    "GITHUB_TOKEN; at most one dispatch per main-batch TARGET",
  "scripts/ci/run-verdict.mjs: try { annotations[j.id] = ghJson(`repos/${repo}/check-runs/$":
    "GITHUB_TOKEN; one read per cancelled job of the one run being judged",
  "scripts/land-queue.mjs: attempt = Number(gh([\"api\", `repos/{owner}/{repo}/actions/ru":
    "one read per CANCELLED required check of the queue head only (reads stop at the head)",
  "scripts/land-queue.mjs: for (const id of step.runIds) gh([\"run\", \"rerun\", id, \"--fai":
    "one re-run per cancelled required check of the head",
  "scripts/land.sh: { gh pr close \"$num\" --delete-branch --comment \"Superseded b":
    "one close per open land/* PR whose head this branch already contains (superseded), once per attempt",
  "scripts/land.sh: gh pr edit \"$BR\" --remove-label land-queue-failed --add-labe":
    "once per land.sh attempt (at most 8)",
  "scripts/land.sh: gh pr merge \"$BR\" --rebase --auto 2>/dev/null || node \"$LAND":
    "once per land.sh attempt (at most 8)",
  "scripts/land.sh: gh workflow run land-queue.yml --ref main >/dev/null 2>&1 ||":
    "once every 10 minutes of a land.sh wait",
  "scripts/lib/landGh.mjs: for (const p of api(\"pulls?state=open&per_page=100\", \"--pagi":
    "one paginated list (pages of 100), not one call per PR",
  "scripts/open-done-when.mjs: return [\"schedule\", \"workflow_dispatch\"].flatMap((event) => ":
    "two run lists per hand-closed alert issue marker (a few), not per run",
  "scripts/ops-alert-ledger.mjs: const iss = gh([\"api\", `repos/${repo}/issues/${ref.issue}`])":
    "GITHUB_TOKEN in its workflows; one issue read per open nightly_red ledger item that names its issue",
  "scripts/ops-alert-ledger.mjs: const issues = gh([\"issue\", \"list\", \"--repo\", repo, \"--label":
    "GITHUB_TOKEN in its workflows; one issue read per open nightly_red ledger item that names its issue",
  "scripts/ops-alert-ledger.mjs: const runs = [\"schedule\", \"workflow_dispatch\"].flatMap((even":
    "GITHUB_TOKEN in its workflows; two run lists per open nightly_red item whose issue was closed (by hand), per sync",
  "scripts/ops-alert-ledger.mjs: const runs = gh([\"run\", \"list\", \"--repo\", repo, \"--workflow\"":
    "one run list per self-recording workflow, cached per workflow",
  "scripts/prune-stale-claims.mjs: const now = api(`repos/{owner}/{repo}/git/ref/heads/${r.name":
    "only with --apply, one re-read per claim being DELETED (the lease); the read side is per-run, not per claim",
  "scripts/prune-stale-claims.mjs: execFileSync(\"gh\", [\"api\", \"-X\", \"DELETE\", `repos/{owner}/{r":
    "only with --apply, one delete per stale claim",
  "scripts/release-gate.mjs: gh([\"workflow\", \"run\", v.file, \"--ref\", ref]);":
    "one dispatch per missing/red release check (a fixed list)",
  "scripts/scoreboard.mjs: parsed = s.parse(sh(\"gh\", [\"run\", \"view\", String(r.id), \"--l":
    "GITHUB_TOKEN; at most 4 log reads per scoreboard suite",
  "scripts/stranded-work.mjs: try { comments = gh([\"pr\", \"view\", String(pr.number), \"--jso":
    "GraphQL, one comments read per PR closed unmerged since 2026-10-03 whose content is still not on main (the stranded set itself; GITHUB_TOKEN in CI)",
};

describe("no GitHub API call per item of a list (the shared 5000/h token)", () => {
  const hits = [...jsHits(), ...shellHits()];
  it("reads the scripts and workflows (inventory floor)", () => {
    expect(jsFiles.length).toBeGreaterThan(100);
    expect(shellFiles.length).toBeGreaterThan(50);
  });
  it("every per-item gh call is bounded and says why; no entry is stale", () => {
    expect(hits.filter((h) => !(h in BOUNDED)), "per-item gh calls with no BOUNDED reason").toEqual([]);
    expect(Object.keys(BOUNDED).filter((k) => !hits.includes(k)), "stale BOUNDED entries").toEqual([]);
  });
});

describe("the PAT entry points skip cleanly when the shared hour is nearly spent", () => {
  const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
  it("reads the budget from real response headers (rate_limit said 5000 left with 440 spent, 2026-10-13)", () => {
    const head = "HTTP/2.0 200 OK\r\nX-Ratelimit-Limit: 5000\r\nX-Ratelimit-Remaining: 4560\r\nX-Ratelimit-Used: 440\r\nX-Ratelimit-Reset: 1791859582\r\n\r\n123";
    expect(parseRateHeaders(head)).toEqual({ remaining: 4560, limit: 5000, used: 440, reset: 1791859582 });
    expect(parseRateHeaders("HTTP/2.0 403 Forbidden\r\n\r\n")).toBeNull();
    expect(blankComments(read("scripts/lib/ghBudget.mjs"))).not.toMatch(/rate_limit/);
    expect(BUDGET_FLOOR).toBe(500);
  });
  it("land-queue.mjs gates before it reads the queue, and its sparse checkout carries the gate", () => {
    const src = blankComments(read("scripts/land-queue.mjs"));
    const gate = src.indexOf("budget.remaining < BUDGET_FLOOR");
    expect(gate).toBeGreaterThan(-1);
    expect(src.indexOf("const prs = readQueue();")).toBeGreaterThan(gate);
    expect(read(".github/workflows/land-queue.yml")).toMatch(/sparse-checkout: \|\n\s+scripts\/land-queue\.mjs\n\s+scripts\/lib\/ghBudget\.mjs/);
  });
  it("refresh-pr gates before its first gh call", () => {
    const src = blankHashComments(read(".github/actions/refresh-pr/action.yml"));
    const gate = src.indexOf("node scripts/lib/ghBudget.mjs");
    expect(gate).toBeGreaterThan(-1);
    expect(src.indexOf("gh pr list")).toBeGreaterThan(gate);
  });
});
