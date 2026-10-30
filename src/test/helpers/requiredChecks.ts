/**
 * Main's REQUIRED status checks: a copy of a GitHub setting, kept ONCE.
 *
 * Three tests each kept their own copy, and they drifted: on 2026-10-03
 * refreshPrDispatchCoversRequiredChecks and refreshWorkflowsOpenPrs listed 3
 * checks (as measured 2026-09-23/24) while branch protection required 4, so
 * "Lint, type-check, build, test" was checked by neither. Every test that needs
 * the list imports it from here; re-measure and update it in the same commit as
 * any branch-protection change:
 *
 *   gh api repos/louisianahelpr/louisianahelpr/rulesets/24543186 \
 *     --jq '.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks[] | "\(.context) app=\(.integration_id)"'
 *
 * (Since 2026-10-05 the checks live in the "main" ruleset; the classic
 * branches/main/protection endpoint answers 404 "Branch not protected".)
 *
 * Measured 2026-10-03 with CodeQL added (owner: "CodeQL REQUIRED on main", Q1151).
 * `workflow` is the file whose job posts the check; null for a check GitHub
 * posts itself (app 57789 github-advanced-security, from the analyses that
 * .github/workflows/codeql.yml uploads: no job there carries the name).
 *
 * DB Smoke's line is the merge queue step (owner 2026-10-30): it lands with the
 * lead adding that check to the ruleset, and CodeQL moved from default setup to
 * codeql.yml in the same step.
 */
export type RequiredCheck = { name: string; app: number; workflow: string | null };

export const REQUIRED_CHECKS: readonly RequiredCheck[] = [
  { name: "Vitest unit tests", app: 15368, workflow: ".github/workflows/vitest.yml" },
  { name: "Lint, type-check, build, test", app: 15368, workflow: ".github/workflows/test.yml" },
  { name: "Playwright happy-path smoke (mocked Supabase, mobile viewport)", app: 15368, workflow: ".github/workflows/e2e-happy-path.yml" },
  { name: "Playwright mobile viewports (320 / 375 / 414 / 768 / 1024)", app: 15368, workflow: ".github/workflows/mobile-viewports.yml" },
  { name: "Apply migrations + post-job trigger smoke", app: 15368, workflow: ".github/workflows/db-smoke.yml" },
  { name: "CodeQL", app: 57789, workflow: null },
];

/** The required checks a workflow file in this repo produces (what a bot PR must dispatch). */
export const WORKFLOW_CHECKS = REQUIRED_CHECKS.filter((c): c is RequiredCheck & { workflow: string } => c.workflow !== null);
