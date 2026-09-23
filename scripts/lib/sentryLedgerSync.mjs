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

export function sentryIssuesUrl(org, project, base = "https://sentry.io") {
  return `${base}/api/0/projects/${org}/${project}/issues/?query=${encodeURIComponent(SENTRY_SYNC_QUERY)}&statsPeriod=24h&limit=100`;
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
