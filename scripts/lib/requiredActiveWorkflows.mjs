/**
 * Workflows that must never be disabled (owner, 2026-10-12: "make sure nothing
 * can be messed up so we can finish the open list smoothly").
 *
 * open-auto-tick.yml was `disabled_manually` from ~2026-10-07 until the lead
 * re-enabled it 2026-10-12 03:45Z, with no record of why, and nothing ticked
 * for five days. A disabled workflow produces no run, so no red run, so no
 * alert: it is silent by construction. scripts/check-workflows-active.mjs
 * reads every workflow's state over REST and fails on any workflow below that
 * is not `active`; it runs in staleness-watch.yml AND branch-prune.yml, so
 * disabling one watcher is caught by the other.
 *
 * Exact, two-way (src/test/requiredActiveWorkflows.test.ts): every workflow
 * that runs on its own (a `schedule:` or `workflow_run:` trigger) and every
 * refresh-PR bot is in exactly one of these two lists, and every entry names a
 * workflow file that exists.
 */

/** Must read `active` on GitHub. */
export const REQUIRED_ACTIVE = [
  // Deploys (push-triggered): main is not live without them.
  "db-deploy.yml",
  "functions-deploy.yml",
  "prod-deploy.yml",
  // Ticking and the open list.
  "open-auto-tick.yml",
  "open-done-when.yml",
  // Every workflow that runs on its own (schedule or workflow_run).
  "a11y-webkit-prod.yml",
  "app-store-reviews.yml",
  "branch-prune.yml",
  "broken-links.yml",
  "code-scanning-alerts.yml",
  "core-loop-canary.yml",
  "db-backup.yml",
  "db-drift-detect.yml",
  "db-restore-drill.yml",
  "dependabot-auto-merge.yml",
  "e2e-abuse-notifications.yml",
  "e2e-journeys.yml",
  "e2e-real-backend.yml",
  "edge-function-smoke.yml",
  "eslint.yml",
  "expiry-monitor.yml",
  "land-queue.yml",
  "lighthouse.yml",
  "loading-states-refresh.yml",
  "main-batch.yml",
  "main-red-watch.yml",
  "morning-page.yml",
  "nightly-red-age.yml",
  "nightly-webkit.yml",
  "press-every-control.yml",
  "privacy-journey.yml",
  "prod-audit.yml",
  "prod-errors.yml",
  "prod-freshness.yml",
  "quota-monitor.yml",
  "race-runner.yml",
  "schedule-heartbeat.yml",
  "scoreboard.yml",
  "security-audit.yml",
  "slow-network.yml",
  "staleness-watch.yml",
  "stripe-webhook-guard.yml",
  "supabase-usage.yml",
  "ui-sweep.yml",
  "uptime.yml",
  "vacuity.yml",
  "write-contract-refresh.yml",
];

/** Run on their own or land through the refresh PR, but may be disabled: file -> why. */
// @two-way src/test/requiredActiveWorkflows.test.ts:no longer runs on its own: drop it from EXEMPT_FROM_ACTIVE
export const EXEMPT_FROM_ACTIVE = {
  "ios-icon-sync.yml":
    "a refresh-PR bot that only a person dispatches (no schedule, no workflow_run); disabled, nothing that runs on its own stops",
  "ios-metadata.yml":
    "a refresh-PR bot that only a person dispatches (no schedule, no workflow_run); disabled, nothing that runs on its own stops",
};

/**
 * The required workflows GitHub does not report as `active`.
 * @param {{path: string, state: string}[]} apiWorkflows  `GET /repos/{o}/{r}/actions/workflows`
 * @param {string[]} required  file names under .github/workflows
 * @returns {{file: string, state: string}[]}
 */
export function inactiveRequired(apiWorkflows, required = REQUIRED_ACTIVE) {
  const state = new Map(apiWorkflows.map((w) => [String(w.path).replace(/^\.github\/workflows\//, ""), String(w.state)]));
  return required
    .map((file) => ({ file, state: state.get(file) ?? "missing from the API listing" }))
    .filter((w) => w.state !== "active");
}
