// @mutate scripts/land.sh |   npx vitest run --changed origin/main --passWithNoTests | 
// @mutate scripts/land.sh |   npm run -s check:counts\n | 
// @mutate scripts/land.sh |     src/test/deadcodeRatchet.test.ts \ |     \
// @mutate scripts/land.sh |   gh pr merge "$BR" --rebase --auto |   git push --no-verify origin HEAD:main
// @mutate scripts/land.sh |     if ! INFO=$(gh pr view "$BR" --json state,mergeStateStatus 2>/dev/null); then |     if ! INFO=$(gh pr view "$BR" --json state,mergeStateStatus); [ "$INFO" ]; then
// @mutate scripts/land.sh |     git reset -q --hard "$START_HEAD" |     true
// @mutate scripts/land.sh | if [ "$MSS" = DIRTY ]; then | if [ "$MSS" = DIRTYX ]; then
// @mutate scripts/land.sh |   if [ "$N_REFRESH" -gt 0 ]; then |   if false; then
// @mutate scripts/land.sh |   SUBJECTS=$(git log --format=%s origin/main..HEAD) |   SUBJECTS=$(git log --format=%s origin/main..HEAD \| grep -qxF "$REFRESH_SUBJECT")
// @mutate .github/workflows/vacuity.yml |       - "LICENSE"\n  schedule: |       - "LICENSE"\n  pull_request:\n    branches: [main]\n  schedule:
// @mutate .github/workflows/vacuity.yml | VACUITY_PUSH_BEFORE: ${{ github.event.before }}\n        # Per push: ratchet | VACUITY_PUSH_BEFORE: ""\n        # Per push: ratchet
// @mutate .github/workflows/vacuity.yml | VACUITY_PUSH_BEFORE: ${{ github.event.before }}\n        # The same scope as the unit job | VACUITY_PUSH_BEFORE: ""\n        # The same scope as the unit job
// @mutate .claude/AGENT-BRIEF.md | requires Vitest, Test and | requires Vitest, Test, Vacuity and
// @mutate scripts/land.sh |     if ! node scripts/perf/critical-path.mjs --check; then |     if false; then
// @mutate scripts/land.sh | grep -qE '^(src/\|public/ | grep -qE '^(public/
// @mutate scripts/land.sh |       exit 1\n    fi\n  else\n    echo "land: nothing the bundle |       true\n    fi\n  else\n    echo "land: nothing the bundle
// @mutate .github/workflows/test.yml |   pull_request:\n    branches: [main]\n |   pull_request:\n    branches: [main]\n    paths-ignore:\n      - "docs/**"\n
/*
 * Nothing reaches main without passing its checks (OPEN.md Q44).
 *
 * Main Vitest went red on 12 of 16 finished runs on 2026-09-30, every one from
 * a direct `git push --no-verify origin HEAD:main` that skipped an exact-count
 * guard. The fix has three parts in the repo (branch protection, the fourth,
 * lives on GitHub: required checks, strict, enforce_admins):
 *   - scripts/land.sh lands through a PR with auto-merge, never a direct push;
 *   - it runs the exact-count guards on the rebased tree before pushing;
 *   - every workflow behind a REQUIRED check runs on every PR (no path
 *     filter), or a docs-only PR waits forever for a check that never starts.
 *
 * Vacuity ("Guards shown able to fail") was a fifth required check until
 * 2026-10-01: PR #2050's run took 112 min and blocked landing. The owner moved
 * it to every push to main (not required on PRs), scoped to what that push
 * changed, queued rather than cancelled, plus the scheduled full sweep.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { REQUIRED_CHECKS as ALL_REQUIRED, WORKFLOW_CHECKS } from "./helpers/requiredChecks";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// The required status checks on main (one copy: ./helpers/requiredChecks), and
// the workflow each comes from. CodeQL is posted by GitHub's code scanning
// default setup, not by a workflow file here.
const REQUIRED_CHECKS: Record<string, string> = Object.fromEntries(WORKFLOW_CHECKS.map((c) => [c.name, c.workflow]));

const COUNT_GUARDS = [
  "src/test/deadcodeRatchet.test.ts",
  "src/test/openPartlyDoneItemsSayDoneWhen.test.ts",
  "src/test/requestBudget.test.ts",
  "src/test/expiryMonitor.test.ts",
  "src/test/componentSizeRatchet.test.ts",
];

// The pull_request block of a workflow's `on:`, up to the next top-level or
// sibling trigger key.
function pullRequestBlock(yml: string): string | null {
  const m = yml.match(/^ {2}pull_request:\n((?: {4}.*\n|\s*\n)*)/m);
  return m ? m[1] : null;
}

describe("landing path (Q44)", () => {
  const land = read("scripts/land.sh");
  const code = land
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");

  it("names every required check and every count guard", () => {
    expect(ALL_REQUIRED.map((c) => c.name)).toEqual([...Object.keys(REQUIRED_CHECKS), "CodeQL"]);
    expect(Object.keys(REQUIRED_CHECKS)).toHaveLength(4);
    expect(COUNT_GUARDS).toHaveLength(5);
  });

  it("land.sh never pushes straight to main", () => {
    expect(code).not.toMatch(/git push[^\n]*HEAD:main/);
    expect(code).toMatch(/gh pr merge "\$BR" --rebase --auto/);
  });

  it("land.sh rebases again when its PR conflicts, dropping its own refresh commits first", () => {
    // 2026-10-03: #2210 and #2211 went DIRTY the moment #2212 merged (all three
    // regenerate the same docs). With strict off, main moving shows as DIRTY,
    // not BEHIND, so the wait loop sat on them; each needed a hand
    // `git rebase --skip` of its refresh commit and a re-run.
    // Since the land queue (2026-10-05) BEHIND is the queue's (scripts/land-queue.mjs
    // rebases only the head); DIRTY still loops back to the local rebase.
    expect(code).toMatch(/if \[ "\$MSS" = DIRTY \]; then/);
    expect(code).toMatch(/SUBJECTS=\$\(git log --format=%s origin\/main\.\.HEAD\)\n\s*N_REFRESH=\$\(grep -cxF "\$REFRESH_SUBJECT" <<<"\$SUBJECTS" \|\| true\)\n\s*N_ALL=\$\(grep -c \. <<<"\$SUBJECTS" \|\| true\)\n\s*if \[ "\$N_REFRESH" -gt 0 \]; then/);
    // never `cmd | grep -q` under pipefail: SIGPIPE makes the test random
    // (it skipped the migration twins, or re-opened an open PR, at random)
    expect(code).toMatch(/^set -euo pipefail$/m);
    expect(code).not.toMatch(/\|\s*grep -q/);
    expect(code).toMatch(/GIT_SEQUENCE_EDITOR="sed -E -i\.land-bak -e '\/\^\(pick\|p\) \[0-9a-f\]\+ \(# \)\?\$REFRESH_SUBJECT/);
    expect(code).toContain('REFRESH_SUBJECT="chore: refresh generated inventories"');
    expect(code).toContain('-m "chore: refresh generated inventories');
  });

  it("land.sh survives a GitHub hiccup and never restarts the checks for nothing", () => {
    // 2026-10-03: an HTTP 503 from gh pr view ended a wait under set -e while
    // the PR was fine; a re-run then minted a new SHA for an identical tree.
    expect(code).toMatch(/if ! INFO=\$\(gh pr view "\$BR" --json state,mergeStateStatus 2>\/dev\/null\); then\n[^\n]*\n\s*continue\n\s*fi/);
    expect(code).toMatch(/START_HEAD=\$\(git rev-parse HEAD\)/);
    expect(code).toMatch(/git merge-base --is-ancestor origin\/main "\$START_HEAD"; then\n\s*git reset -q --hard "\$START_HEAD"/);
    // the reuse runs before the push
    expect(code.indexOf('git reset -q --hard "$START_HEAD"')).toBeLessThan(code.indexOf("git push --no-verify --force"));
  });

  it("land.sh closes any open land PR its HEAD supersedes", () => {
    // 2026-10-02: #2063 and #2070 carried the same commits from two worktrees.
    expect(code).toMatch(/merge-base --is-ancestor "\$oid" HEAD/);
    expect(code).toMatch(/gh pr close "\$num" --delete-branch/);
  });

  it("land.sh runs every exact-count guard before pushing", () => {
    const pushAt = code.indexOf("git push");
    for (const g of COUNT_GUARDS) {
      expect(existsSync(join(ROOT, g)), g).toBe(true);
      const at = code.indexOf(g);
      expect(at, `${g} missing from land.sh`).toBeGreaterThan(-1);
      expect(at, `${g} runs after the push`).toBeLessThan(pushAt);
    }
  });

  it("land.sh builds the bundle and checks the critical-path budget before pushing (Q178)", () => {
    // 2026-10-05: batch PR #2406 took /login from 274 to 293 KB gz (budget
    // 271, +5% allowed) and would have merged with it: CI's "Bundle Size
    // Check" runs this budget but is not a required check.
    const CHECK = "node scripts/perf/critical-path.mjs --check";
    const buildAt = code.indexOf("npx vite build");
    const checkAt = code.indexOf(CHECK);
    const dryAt = code.indexOf('if [ "$DRY" = 1 ]');
    const pushAt = code.indexOf("git push");
    expect(buildAt, "land.sh never builds the bundle").toBeGreaterThan(-1);
    expect(checkAt, "land.sh never runs the critical-path budget").toBeGreaterThan(buildAt);
    // before the --dry-run exit (so a dry run proves it) and before the push
    expect(checkAt).toBeLessThan(dryAt);
    expect(dryAt).toBeLessThan(pushAt);
    // the same command CI's bundle-size job runs
    expect(read(".github/workflows/bundle-size.yml")).toContain(`run: ${CHECK}`);
    // a failed build or a route over budget stops the land red
    expect(code).toMatch(/if ! npx vite build >"\$BUILD_LOG" 2>&1; then\n(?:[^\n]*\n){2}\s*exit 1\n/);
    expect(code).toMatch(/if ! node scripts\/perf\/critical-path\.mjs --check; then\n[^\n]*\n\s*exit 1\n/);
    // a fresh worktree has no .env and vite.config.ts refuses to build without it
    expect(code).toContain('ln -s "$MAIN_TREE/.env" .env');

    // Skipped only when the push changes nothing the bundle is built from.
    const gates = [...code.slice(0, buildAt).matchAll(/if grep -qE '([^']+)' <<<"\$PUSHED_FILES"; then/g)];
    expect(gates.length, "no PUSHED_FILES gate before the build").toBeGreaterThan(0);
    const trigger = new RegExp(gates[gates.length - 1][1], "m");
    // every path CI's bundle-size workflow treats as a bundle input (its own
    // file aside) must trigger the local build too
    const yml = parse(read(".github/workflows/bundle-size.yml")) as { on: { pull_request: { paths: string[] } } };
    const ciPaths = yml.on.pull_request.paths.filter((p) => !p.startsWith(".github/"));
    expect(ciPaths.length).toBeGreaterThan(4);
    const samples = [
      ...ciPaths.map((p) => p.replace("**", "pages/auth/Login.tsx")),
      "public/sw.js",
      "vite.config.mts",
      "scripts/perf/critical-path-budget.json",
    ];
    for (const f of samples) expect(trigger.test(f), `${f} skips the bundle budget`).toBe(true);
    for (const f of ["docs/OPEN.md", "supabase/functions/stripe-webhook/index.ts","scripts/land.sh", "e2e/a.spec.ts"])
      expect(trigger.test(f), `${f} triggers a needless build`).toBe(false);
  });

  it("CodeQL comes from code scanning default setup, so no workflow file may compete with it", () => {
    // An advanced codeql.yml cannot upload while default setup is on (the
    // owner's louisianahelpr-patch-1 PR runs failed exactly so); a job named
    // "CodeQL" would post a second check under the required name.
    expect(existsSync(join(ROOT, ".github/workflows/codeql.yml"))).toBe(false);
    expect(existsSync(join(ROOT, ".github/workflows/codeql.yaml"))).toBe(false);
    for (const c of ALL_REQUIRED.filter((r) => r.workflow === null)) {
      expect(c.app, `${c.name} is posted by github-advanced-security`).toBe(57789);
    }
  });

  it.each(Object.entries(REQUIRED_CHECKS))("required check %s runs on every PR", (name, file) => {
    const yml = read(file);
    expect(yml, `${file} has no job named ${name}`).toContain(`name: ${name}`);
    const pr = pullRequestBlock(yml);
    expect(pr, `${file} does not run on pull_request`).not.toBeNull();
    expect(pr, `${file} filters PR paths, so a PR outside them never gets "${name}"`).not.toMatch(
      /paths(-ignore)?:/,
    );
  });

  describe("vacuity runs on every push to main, not on PRs (owner, 2026-10-01)", () => {
    const yml = read(".github/workflows/vacuity.yml");

    it("has no pull_request trigger and runs on push to main", () => {
      expect(pullRequestBlock(yml), "vacuity.yml runs on pull_request again").toBeNull();
      expect(yml).toMatch(/^on:\n {2}push:\n {4}branches: \[main\]/m);
      expect(yml).toMatch(/^ {2}workflow_dispatch:/m);
      expect(yml).toMatch(/^ {2}schedule:/m);
    });

    it("scopes a push run to everything the push brought, not its last commit", () => {
      // Every job that scopes by the push (the gate, the Playwright gate, and the
      // `scope` job that decides whether the latter runs, Q551) takes it, or the
      // three would disagree about what the push changed.
      const jobs = (parse(yml) as { jobs: Record<string, { steps?: { env?: Record<string, string> }[] }> }).jobs;
      for (const j of ["scope", "vacuity", "vacuity-e2e"])
        expect(
          (jobs[j].steps ?? []).some((s) => s.env?.VACUITY_PUSH_BEFORE === "${{ github.event.before }}"),
          `${j} does not scope by the push`,
        ).toBe(true);
    });

    it("queues push runs instead of dropping them", () => {
      const m = yml.match(/^concurrency:\n {2}group: (.*)\n {2}cancel-in-progress: (\w+)/m);
      expect(m, "vacuity.yml has no top-level concurrency block").not.toBeNull();
      // A per-ref group keeps only ONE pending run, so a third push in a row
      // would replace the second's pending run and that push is never proven.
      expect(m![1]).toContain("github.sha");
      expect(m![2]).toBe("false");
    });

    it.each(["CLAUDE.md", ".claude/AGENT-BRIEF.md", "scripts/land.sh"])(
      "%s lists four required checks and says vacuity runs on every push",
      (p) => {
        const t = read(p).replace(/\s*\n\s*#?\s*/g, " ");
        expect(t).not.toMatch(/Test, Vacuity and/);
        expect(t).toMatch(/Vitest, Test and (both|the two) Playwright checks/);
        expect(t).toContain("vacuity runs on every push to main (not required on PRs)");
      },
    );
  });
});

describe("land.sh first-try pass (owner, 2026-10-05: make landings pass on the first GitHub round)", () => {
  const land = readFileSync(join(__dirname, "..", "..", "scripts", "land.sh"), "utf8");
  const pushAt = land.indexOf('git push --no-verify --force origin "HEAD:refs/heads/$BR"');
  it("runs ESLint on changed files, check:counts, related and path-naming tests, and the GitHub-only guards before the push", () => {
    for (const needle of [
      "npx eslint --quiet $CHANGED_LINT",
      "npm run -s check:counts",
      "npx vitest run --changed origin/main --passWithNoTests",
      'git grep -l -F -- "$b"',
      "src/test/fixtureSchemaContract.test.ts",
      "src/test/workflowFalseGreenShapes.test.ts",
    ]) {
      const at = land.indexOf(needle);
      expect(at, needle).toBeGreaterThan(-1);
      expect(at, `${needle} must run before the push`).toBeLessThan(pushAt);
    }
  });
});
