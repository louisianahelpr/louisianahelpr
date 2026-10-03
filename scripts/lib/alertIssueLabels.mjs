/**
 * Every GitHub issue label a workflow FILES an alert under, and the workflow
 * whose own green run closes it. ONE table, read by both mirrors of those
 * issues and by the checker of their done-when markers:
 *   scripts/ops-alert-ledger.mjs sync    -> public.ops_alert_ledger
 *   scripts/open-sync-trackers.mjs       -> docs/OPEN.md (`feed: issue #N`)
 *   scripts/open-done-when.mjs           -> `done-when: issue #N closed`
 *
 * Before 2026-10-03 the ledger listed four labels by hand and the OPEN.md feed
 * one (nightly-red), so `schedule-stalled` (schedule-heartbeat.yml, issue
 * #2196) and `migration-drift` (db-drift-detect.yml) reached neither: an open
 * alert nobody's list carried. src/test/alertIssueLabelsMirrored.test.ts
 * derives the labels from the workflow files and fails, both ways, when this
 * table disagrees with them.
 *
 * filedBy: the workflow file that opens the issue and closes it on its own
 * green run. null for nightly-red, whose issues are one per workflow, titled
 * "nightly-red: <workflow>": the title names the workflow.
 */
// @two-way src/test/alertIssueLabelsMirrored.test.ts:const notFiled =
export const ALERT_ISSUE_LABELS = {
  "nightly-red": { severity: "error", filedBy: null },
  "prod-down": { severity: "critical", filedBy: "uptime.yml" },
  "prod-errors": { severity: "error", filedBy: "prod-errors.yml" },
  "supabase-usage": { severity: "error", filedBy: "supabase-usage.yml" },
  "schedule-stalled": { severity: "error", filedBy: "schedule-heartbeat.yml" },
  "migration-drift": { severity: "error", filedBy: "db-drift-detect.yml" },
};

/** Labels a workflow files issues under that are NOT alerts, with why. */
// @two-way src/test/alertIssueLabelsMirrored.test.ts:const staleNotAlert =
export const NOT_ALERT_LABELS = {
  "privacy-journey-marker":
    "a standing record, not an alert: privacy-journey.yml writes the month of its last green due run into it and schedule-heartbeat.yml reads that",
};

/** The alert labels, in table order. */
export const ALERT_LABELS = Object.keys(ALERT_ISSUE_LABELS);

const names = (issue) => (issue?.labels ?? []).map((l) => (typeof l === "string" ? l : l?.name)).filter(Boolean);

/** The alert label an issue (REST or gh shape: labels as strings or {name}) is filed under, or null. */
export function alertLabelOf(issue) {
  const has = new Set(names(issue));
  return ALERT_LABELS.find((l) => has.has(l)) ?? null;
}

/**
 * The workflow file whose own green run closes `issue`: its label's filedBy,
 * else the one its title names (`byTitle(title)`, for nightly-red), else null.
 */
export function alertWorkflowOf(issue, byTitle = () => null) {
  const label = alertLabelOf(issue);
  if (!label) return null;
  return ALERT_ISSUE_LABELS[label].filedBy ?? byTitle(String(issue.title ?? "")) ?? null;
}
