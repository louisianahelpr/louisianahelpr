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

/**
 * ONE ERROR = ONE FINGERPRINT (owner, 2026-10-14: the FEEDS list kept
 * refilling with copies). ops_alert_apply keys a row on md5(kind|source|title),
 * and Sentry's culprit names a Vite bundle by its CONTENT HASH plus a minified
 * function name: `cu(assets/app-shared-DUoNbpYC)` one deploy,
 * `Ku(assets/app-shared-CkIDj-oG)` the next. Measured on prod 2026-10-14
 * (ops_alert_ledger, source_kind 'sentry'): "permission denied for table
 * profiles" was 5 rows under 5 sources, "session lost on a signed-in screen"
 * 3, and each row became its own docs/OPEN.md item (Q1596/Q1811,
 * Q1636/Q1812). So the source keeps only what survives a deploy: for a
 * hashed bundle file (`assets/<name>-<8-char hash>[.js]`) the bundle's NAME,
 * with no hash and no function (a minified name is noise: `?` and
 * `f.<anonymous>` were the same JAVASCRIPT-1Q). Any other culprit (a real
 * function in a real file) is kept as it is.
 *
 * The SQL twin public.ops_alert_sentry_source(text) (migration
 * *_sentry_alerts_fold_bundle_hashes) re-keyed the rows recorded before
 * this; src/test/sentryCulpritOneFingerprint.test.ts holds both to the same
 * answers.
 */
const CALL = /^([^()]*)\(([^()]*)\)$/;
// A hash has a capital, a digit, `_` or `-` among its 8 characters; an all
// lower-case word is part of the NAME (`assets/tiktok-provider`), which keeps
// the key idempotent: sentryCulpritKey(sentryCulpritKey(c)) === sentryCulpritKey(c).
const HASHED_BUNDLE = /^(.*\/)?([^/]*)-(?=[A-Za-z0-9_-]{0,7}[A-Z0-9_-])[A-Za-z0-9_-]{8}(\.m?js)?$/;
const IN_ASSETS = /(^|\/)assets\//;
/** The three patterns, for the SQL-twin check (src/test/sentryCulpritOneFingerprint.test.ts). */
export const SENTRY_CULPRIT_PATTERNS = { CALL, HASHED_BUNDLE, IN_ASSETS };

export function sentryCulpritKey(culprit) {
  const raw = String(culprit ?? "").trim();
  if (!raw) return "unknown";
  const call = CALL.exec(raw);
  const loc = call ? call[2] : raw;
  const hashed = IN_ASSETS.test(loc) ? HASHED_BUNDLE.exec(loc) : null;
  if (!hashed) return raw;
  return `${(hashed[1] ?? "").replace(/^\//, "")}${hashed[2]}`;
}

/** One Sentry issue as a ledger occurrence (recordOpsAlert's argument). */
export function sentryIssueToAlert(i) {
  const status = String(i?.status ?? "unknown");
  const substatus = i?.substatus ? String(i.substatus) : null;
  const state = substatus ? `${status}/${substatus}` : status;
  return {
    sourceKind: "sentry",
    source: `sentry:${sentryCulpritKey(i?.culprit)}`.slice(0, 120),
    title: i?.title ?? "(no title)",
    severity: i?.level === "fatal" ? "fatal" : i?.level === "warning" ? "warning" : "error",
    sample: `${i?.title} — Sentry ${i?.shortId ?? i?.id} (${state} in Sentry; last event ${i?.lastSeen}) — ${i?.permalink}`,
    sampleRef: { sentry_id: i?.id, short_id: i?.shortId ?? null, url: i?.permalink, sentry_status: status, sentry_substatus: substatus },
    seenAt: i?.lastSeen,
  };
}
