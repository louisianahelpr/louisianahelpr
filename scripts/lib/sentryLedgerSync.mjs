/**
 * Sentry -> ops alert ledger (docs/OPEN.md Q11). Pure helpers; the hourly
 * `ops-alert-ledger.mjs sync` does the fetch and the writes.
 *
 * WHY NOT `is:unresolved`. MEASURED 2026-09-23: every Sentry issue in
 * helpr-4m is closed by Sentry itself one hour after its last event
 * (activity `set_resolved_by_age`, age 1, "by system"), and reopened by the
 * next event (`set_regression`). JAVASCRIPT-1H went through that cycle 20
 * times from 09-11 to 09-23 and read "resolved" while still firing; the
 * 09-22 profile-timeout issues (2E/2F/2G) were resolved the same way, with no
 * fix. So Sentry's `status` says only "no event in the last hour". The ledger
 * therefore takes every issue with an event in the window WHATEVER its
 * status, at its real lastSeen: a regression is a new occurrence, and the
 * ledger's own rule (ops_alert_apply) reopens a closed item when an
 * occurrence is newer than the close. Sentry's status and substatus
 * (e.g. "regressed") ride along in sample_ref for the reader.
 */

/** Any status. The window is the hourly sync's, with an hour of overlap. */
export const SENTRY_SYNC_QUERY = "lastSeen:-25h";

/**
 * The token that can READ issues. SENTRY_AUTH_TOKEN is the release-upload
 * token and answers 403 on the issues API (measured: prod-errors run
 * 35895960717, 2026-09-23T17:30Z); SENTRY_READ_TOKEN is the owner-created
 * read token the quota monitor already uses.
 */
export function sentryReadToken(env) {
  return env.SENTRY_READ_TOKEN || env.SENTRY_AUTH_TOKEN || "";
}

/**
 * A sync with no Sentry credentials is an alert only where the credentials
 * are supposed to be: the prod-errors.yml run. A local `sync` (no repo
 * secrets on a laptop) recording it reopened the warning 6 times by
 * 2026-09-26 while CI read Sentry fine every run.
 */
export function missingSentryEnvIsAlert(env) {
  return env.GITHUB_ACTIONS === "true";
}

export function sentryIssuesUrl(org, project, base = "https://sentry.io") {
  return `${base}/api/0/projects/${org}/${project}/issues/?query=${encodeURIComponent(SENTRY_SYNC_QUERY)}&statsPeriod=24h&limit=100`;
}

/**
 * AN AUTOMATED BROWSER NEVER REOPENS A LEDGER ITEM (Q1604). src/lib/sentry.ts
 * tags every event `automated: "true"|"false"` (navigator.webdriver, Q275),
 * and the journeys type deliberate bad input on prod: ZIP 99999 keeps a test
 * job's parish null so no real Helpr is notified (e2e/journeys/postJobForm.ts).
 * Sentry groups those with the real user's event of the same shape, so the
 * issue's lastSeen moved on every journey run and reopened the item each time
 * (JAVASCRIPT-1V, measured 2026-10-12: 39 untagged events from 09-13, 4
 * automated, 1 real). The error_logs path already skips rows tagged automated.
 *
 * So the occurrence is the newest event that was NOT automated, read from the
 * issue's own `automated` tag distribution (each value carries its lastSeen).
 * An untagged event ("" — from before the tag existed) counts as real. If the
 * distribution cannot be read, the issue's own lastSeen stands: a broken read
 * never hides an alert.
 */
export function sentryIssueTagUrl(org, issueId, key = "automated", base = "https://sentry.io") {
  return `${base}/api/0/organizations/${org}/issues/${encodeURIComponent(issueId)}/tags/${key}/`;
}

/**
 * @returns the lastSeen of the newest non-automated event, `fallback` when the
 * tag answer is unreadable, or null when every event was automated.
 */
export function realOccurrenceAt(tag, fallback) {
  const values = tag && Array.isArray(tag.topValues) ? tag.topValues : null;
  if (!values || values.length === 0) return fallback ?? null;
  let newest = null;
  for (const v of values) {
    if (String(v?.value) === "true") continue;
    const at = v?.lastSeen;
    if (typeof at !== "string" || Number.isNaN(Date.parse(at))) return fallback ?? null;
    if (!newest || Date.parse(at) > Date.parse(newest)) newest = at;
  }
  return newest;
}

/** One Sentry issue as a ledger occurrence (recordOpsAlert's argument). */
export function sentryIssueToAlert(i) {
  const status = String(i?.status ?? "unknown");
  const substatus = i?.substatus ? String(i.substatus) : null;
  const state = substatus ? `${status}/${substatus}` : status;
  return {
    sourceKind: "sentry",
    source: `sentry:${i?.culprit ?? "unknown"}`.slice(0, 120),
    title: i?.title ?? "(no title)",
    severity: i?.level === "fatal" ? "fatal" : i?.level === "warning" ? "warning" : "error",
    sample: `${i?.title} — Sentry ${i?.shortId ?? i?.id} (${state} in Sentry; last event ${i?.lastSeen}) — ${i?.permalink}`,
    sampleRef: { sentry_id: i?.id, short_id: i?.shortId ?? null, url: i?.permalink, sentry_status: status, sentry_substatus: substatus },
    seenAt: i?.lastSeen,
  };
}
