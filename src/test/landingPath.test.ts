// @mutate scripts/land.sh |     src/test/deadcodeRatchet.test.ts \ |     \
// @mutate scripts/land.sh |   gh pr merge "$BR" --rebase --auto |   git push --no-verify origin HEAD:main
// @mutate .github/workflows/vacuity.yml |       - "LICENSE"\n  schedule: |       - "LICENSE"\n  pull_request:\n    branches: [main]\n  schedule:
// @mutate .github/workflows/vacuity.yml | VACUITY_PUSH_BEFORE: ${{ github.event.before }} | VACUITY_PUSH_BEFORE: ""
// @mutate .claude/AGENT-BRIEF.md | requires Vitest, Test and both Playwright | requires Vitest, Test, Vacuity and both Playwright
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

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// The required status checks on main, and the workflow each comes from.
const REQUIRED_CHECKS: Record<string, string> = {
  "Vitest unit tests": ".github/workflows/vitest.yml",
  "Lint, type-check, build, test": ".github/workflows/test.yml",
  "Playwright happy-path smoke (mocked Supabase, mobile viewport)": ".github/workflows/e2e-happy-path.yml",
  "Playwright mobile viewports (320 / 375 / 414 / 768 / 1024)": ".github/workflows/mobile-viewports.yml",
};

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
    expect(Object.keys(REQUIRED_CHECKS)).toHaveLength(4);
    expect(COUNT_GUARDS).toHaveLength(5);
  });

  it("land.sh never pushes straight to main", () => {
    expect(code).not.toMatch(/git push[^\n]*HEAD:main/);
    expect(code).toMatch(/gh pr merge "\$BR" --rebase --auto/);
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
      expect(yml).toContain("VACUITY_PUSH_BEFORE: ${{ github.event.before }}");
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
