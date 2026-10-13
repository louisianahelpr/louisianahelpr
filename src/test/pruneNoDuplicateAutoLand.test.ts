/*
 * GUARD (lead, 2026-10-12: 144 open PRs, the same change in 2-4 of them).
 * branch-prune.yml (scripts/prune-stale-branches.mjs) runs on every push to
 * main and opened an "auto-land: <branch>" PR for every stranded branch, with
 * no cap. It opened them for:
 *   - claim/* branches, a lane's claim marker on a queue item, never work to
 *     land (#2814 claim/Q1357, #2815 claim/Q1500, #2848 claim/Q1344, #2849);
 *   - branches whose content another open PR already carried: the land
 *     queue's fix-land/q1287 rebuild got #2818 while local/q1287 had #2771.
 * Now neither is stranded (content compared with scripts/lib/strandedContent.mjs,
 * pooled over every open PR head). Since 2026-10-13 the script opens no PR at
 * all (report only, one landing path: src/test/pruneStaleBranches.test.ts).
 *
 * Red first: on origin/main's script, findStranded() returns claim/Q1357 and
 * fix-land/rebuilt as stranded, and the budget does not exist.
 */
// @mutate scripts/prune-stale-branches.mjs |   if (NEVER_STRANDED_PREFIXES.some((p) => name.startsWith(p))) return false; |
// @mutate scripts/prune-stale-branches.mjs |   if (contentInOpenPr) return false; |
// @mutate scripts/lib/strandedContent.mjs |     if (f.missing.some((s) => !idx.added.has(s))) return false; |
// @mutate scripts/lib/strandedContent.mjs |       if (l.startsWith("+")) added.add(s); |       if (false) added.add(s);
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  buildMainIndex,
  buildRefsContentIndex,
  contentCoveredBy,
  gitRunner,
  unlandedContent,
} from "../../scripts/lib/strandedContent.mjs";
import { findStranded, isStranded } from "../../scripts/prune-stale-branches.mjs";

let root = "";
let repo = "";

function git(cwd: string, ...argv: string[]) {
  return execFileSync("git", argv, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@e", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@e",
      GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0",
    },
  }).trim();
}
function write(file: string, body: string) {
  mkdirSync(dirname(join(repo, file)), { recursive: true });
  writeFileSync(join(repo, file), body);
}
function commit(msg: string) {
  git(repo, "add", "-A");
  git(repo, "-c", "commit.gpgsign=false", "commit", "-q", "-m", msg);
}

const BASE = "export const alpha = 'the first line of the module';\n";
const WORK = "export function rowFix() { return 'the profile rows line up at 375'; }\n";
const MORE = "export const extra = 'a second change only the rebuild carries';\n";
const BRANCHES = ["open-pr-head", "fix-land/rebuilt", "fix-land/rebuilt-plus", "claim/Q1357", "really-stranded"];

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "lh-prune-dupes-")));
  const origin = join(root, "origin.git");
  repo = join(root, "repo");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["clone", "-q", origin, repo], { stdio: "ignore" });
  git(repo, "checkout", "-q", "-b", "main");
  write("src/a.ts", BASE);
  commit("base");
  git(repo, "push", "-q", "origin", "main");

  // The change, with its own open PR (local/q1287 -> #2771's shape).
  git(repo, "checkout", "-q", "-b", "open-pr-head", "main");
  write("src/a.ts", BASE + WORK);
  commit("fix(profile): rows line up (Q1287)");
  // The land queue's rebuild of the same change: new commit, new subject.
  git(repo, "checkout", "-q", "-b", "fix-land/rebuilt", "main");
  write("src/a.ts", BASE + WORK);
  write("docs/SCOREBOARD.md", "regenerated\n");
  commit("fix(profile): rows line up at 375 (rebuilt on main)");
  // A rebuild that also carries a line no open PR has: still stranded.
  git(repo, "checkout", "-q", "-b", "fix-land/rebuilt-plus", "fix-land/rebuilt");
  write("src/b.ts", MORE);
  commit("fix(profile): and one more change");
  // A lane's claim marker.
  git(repo, "checkout", "-q", "-b", "claim/Q1357", "main");
  write("docs/claims/Q1357.txt", "claimed by lane2 for the fixed-clock sweeps work\n");
  commit("claim Q1357");
  // Real stranded work: no PR anywhere carries it.
  git(repo, "checkout", "-q", "-b", "really-stranded", "main");
  write("src/lost.ts", "export const lostWork = 'work that is on neither main nor a PR';\n");
  commit("feat: work that never landed");

  git(repo, "checkout", "-q", "main");
  git(repo, "push", "-q", "origin", ...BRANCHES);
  git(repo, "fetch", "-q", "origin");
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

function judge(openHeads: Set<string>) {
  const run = gitRunner(repo);
  const index = buildMainIndex(run, "origin/main");
  const content = (name: string) => unlandedContent(run, `origin/${name}`, "origin/main", index);
  const openIdx = buildRefsContentIndex(run, "origin/main", [...openHeads].map((h) => `origin/${h}`));
  return {
    contentStrandedOf: (name: string) => content(name).stranded,
    contentInOpenPrOf: (name: string) => contentCoveredBy(content(name), openIdx),
  };
}
const branches = () => BRANCHES.map((name) => ({ name, sha: git(repo, "rev-parse", `origin/${name}`), ageHours: 5 }));
const gitFn = (args: string[]) => git(repo, ...args);

describe("branch-prune reports no duplicate stranded work (once: opened no duplicate auto-land PR)", () => {
  it("the fixture holds every shape (inventory floor)", () => {
    expect(branches().length).toBeGreaterThan(4);
    // Every branch but main's own work is content-stranded vs main, so only
    // the new rules can keep them out of the auto-land list.
    const { contentStrandedOf } = judge(new Set());
    expect(BRANCHES.filter((b) => contentStrandedOf(b)).length).toBe(BRANCHES.length);
  });

  it("a claim/* branch is never stranded, so never auto-landed (#2814, #2815)", () => {
    expect(isStranded({ name: "claim/Q1357", hasOpenPr: false, ageHours: 5, uncovered: [{}] })).toBe(false);
    expect(isStranded({ name: "claimed/thing", hasOpenPr: false, ageHours: 5, uncovered: [{}] })).toBe(true);
  });

  it("a branch whose content an open PR already carries goes to inOpenPr, not stranded (#2818 beside #2771)", () => {
    const openHeads = new Set(["open-pr-head"]);
    const { contentStrandedOf, contentInOpenPrOf } = judge(openHeads);
    const r = findStranded(gitFn, branches(), openHeads, new Map(), contentStrandedOf, contentInOpenPrOf);
    expect(r.inOpenPr.map((b) => b.name)).toEqual(["fix-land/rebuilt"]);
    expect(r.stranded.map((b) => b.name).sort()).toEqual(["fix-land/rebuilt-plus", "really-stranded"]);
  });

  it("with no open PR carrying it, the same rebuild is stranded (the check is content, not the name)", () => {
    const { contentStrandedOf, contentInOpenPrOf } = judge(new Set());
    const r = findStranded(gitFn, branches(), new Set(), new Map(), contentStrandedOf, contentInOpenPrOf);
    expect(r.stranded.map((b) => b.name).sort()).toEqual(["fix-land/rebuilt", "fix-land/rebuilt-plus", "open-pr-head", "really-stranded"]);
    expect(r.inOpenPr).toEqual([]);
  });

  it("main() passes the open-PR content check", () => {
    const src = readFileSync(resolve(__dirname, "../../scripts/prune-stale-branches.mjs"), "utf8");
    expect(src).toMatch(/findStranded\(git, branches, openHeads, readAcceptedTips\(\), contentStrandedOf, contentInOpenPrOf\)/);
  });
});
