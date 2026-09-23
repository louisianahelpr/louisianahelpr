/**
 * Quota and limit monitor (docs/OPEN.md Q63) — pure logic, no I/O.
 * scripts/check-quota-usage.mjs does the reads and calls `evaluateQuotas`.
 * Tested in src/test/quotaMonitor.test.ts.
 *
 * WHAT A ROW MEANS. Every quota the owner named is a row in QUOTAS with its
 * limit, the unit, the window the vendor counts over, and HOW it is read:
 *
 *   read: "sql"      Management API read-only SQL against prod (the token
 *                    every prod workflow already holds).
 *   read: "logs"     Management API logs.all (function_edge_logs).
 *   read: "github"   the GitHub REST API with the workflow's GITHUB_TOKEN.
 *   read: "sentry"   the Sentry REST API (SENTRY_AUTH_TOKEN / ORG / PROJECT).
 *   read: null       NO API exists that this repo can read. Never dropped and
 *                    never graded "ok": the report lists it under
 *                    "NOT MONITORED" with `why`, and the CLI prints a
 *                    ::warning for each one on every run.
 *
 * GRADING (`grade`): used/limit >= warnAt (0.8) -> "warn" (ledger alert,
 * severity warning); >= 1 -> "over" (severity error). A readable row whose
 * read FAILED, or came back with no number, is "unreadable": the ledger gets
 * an error item and the CLI exits 1, so the run is red and nightly-issue-sync
 * files it. A monitor that cannot see is never green.
 *
 * LIMITS. The vendor pricing pages are not reachable from the cloud session
 * that wrote this (egress-blocked), so each `limitSource` says where the
 * number comes from and that it was NOT re-read on 2026-09-23. Every limit can
 * be overridden per run by its `env` variable without a code change; the plan
 * facts the owner gave on 2026-09-23 are: Supabase PRO, Vercel FREE (Hobby),
 * Resend and Sentry "have plan limits" (plan not named -> free tier assumed,
 * and said so in the report).
 */

export const WARN_AT = 0.8;

const GB = 1024 ** 3;

/**
 * THE plan limits, one definition (docs/OPEN.md Q221). Plans measured
 * 2026-09-23: Supabase PRO, Vercel FREE (Hobby). QUOTAS below,
 * scripts/supabase-usage-check.mjs and scripts/lib/vercelUsage.mjs all read
 * their numbers from here; src/test/planLimits.test.ts holds them to it both
 * ways (every consumer reads a limit from here, every limit here has a
 * consumer, no consumer hard-codes a number). `value: null` = the vendor
 * publishes no fixed amount for this plan, so nothing is graded against it.
 * Numbers were NOT re-read from the vendor pages on 2026-09-23 (egress-blocked
 * from the cloud session), which each `source` says.
 */
export const PLANS = { supabase: "Pro", vercel: "Hobby", resend: "Free (assumed)", sentry: "Developer (assumed)" };

export const PLAN_LIMITS = {
  supabase_db_bytes: { value: 8 * GB, unit: "bytes", source: "Supabase Pro: 8 GB disk per project included (pricing page; not re-read 2026-09-23)." },
  supabase_storage_bytes: { value: 100 * GB, unit: "bytes", source: "Supabase Pro: 100 GB file storage included (pricing page; not re-read 2026-09-23)." },
  supabase_edge_invocations_month: { value: 2_000_000, unit: "invocations/month", source: "Supabase Pro: 2,000,000 edge function invocations/month included (pricing page; not re-read 2026-09-23)." },
  supabase_egress_bytes_month: { value: 250 * GB, unit: "bytes/month", source: "Supabase Pro: 250 GB egress/month included (pricing page; not re-read 2026-09-23)." },
  supabase_realtime_messages_month: { value: 5_000_000, unit: "messages/month", source: "Supabase Pro: 5,000,000 Realtime messages/month included (pricing page; not re-read 2026-09-23)." },
  vercel_deploys_per_day: { value: 100, unit: "deployments/day", source: "Vercel Hobby: 100 deployments created per day (limits page; not re-read 2026-09-23). Hit for real on 2026-09-13 (\"Deployment rate limited — retry in 24 hours\")." },
  vercel_edge_requests_month: { value: 1_000_000, unit: "requests/month", source: "Vercel Hobby: 1,000,000 Edge Requests/month included (limits page; not re-read 2026-09-23)." },
  vercel_fast_data_transfer_gb_month: { value: 100, unit: "GB/month", source: "Vercel Hobby: 100 GB Fast Data Transfer/month included (the Hobby tables read \"100 GB\", decimal; not re-read 2026-09-23)." },
  vercel_function_invocations_month: { value: 1_000_000, unit: "invocations/month", source: "Vercel Hobby: 1,000,000 function invocations/month included (the Vercel Functions pricing table, \"1 million included\" under Hobby, read 2026-09-14/15; not re-read 2026-09-23)." },
  vercel_build_minutes_month: { value: null, unit: "CPU minutes/month", source: "Vercel Hobby: no build-minute allowance number sourced in this repo; measured and logged, never graded." },
  resend_emails_month: { value: 3_000, unit: "emails/month", source: "Resend free plan: 3,000 emails/month (ASSUMED: the owner said only 'Resend has plan limits')." },
  resend_emails_day: { value: 100, unit: "emails/day", source: "Resend free plan: 100 emails/day (ASSUMED as above)." },
  sentry_replays_month: { value: 50, unit: "replays/month", source: "Sentry Developer plan: 50 session replays/month (ASSUMED, not re-read 2026-09-23). Measured 2026-09-23: 63 replays accepted in the trailing 30 days, none after 2026-09-14, and the helpr-4m banner read \"Replay Quota Exceeded\" (docs/OPEN.md Q275)." },
  sentry_errors_month: { value: 5_000, unit: "errors/month", source: "Sentry Developer plan: 5,000 errors/month (ASSUMED: the owner said only 'Sentry has plan limits')." },
  vercel_deployment_storage_gb_month: { value: null, unit: "GB-months", source: "Vercel: no published deployment-storage allowance (\"your plan may include an allowance\", no number); measured and logged, never graded." },
};

/** @type {import("./quotaMonitor.d.mts").Quota[]} */
export const QUOTAS = [
  {
    id: "supabase.db_size",
    service: "Supabase",
    name: "Database size",
    limit: PLAN_LIMITS.supabase_db_bytes.value,
    unit: "bytes",
    window: "now",
    read: "sql",
    env: "LH_QUOTA_SUPABASE_DB_BYTES",
    limitSource: "Supabase Pro: 8 GB disk per project included (pricing page; not re-read 2026-09-23). Measured: pg_database_size(current_database()).",
  },
  {
    id: "supabase.connections",
    service: "Supabase",
    name: "Database connections",
    // The real ceiling is read LIVE (SHOW max_connections) and replaces this;
    // null here means "no static number — the database says".
    limit: null,
    unit: "connections",
    window: "now",
    read: "sql",
    env: "LH_QUOTA_SUPABASE_CONNECTIONS",
    limitSource: "Live: current_setting('max_connections') on prod (depends on the compute size, so never hard-coded). Measured: count(*) from pg_stat_activity.",
  },
  {
    id: "supabase.storage",
    service: "Supabase",
    name: "File storage",
    limit: PLAN_LIMITS.supabase_storage_bytes.value,
    unit: "bytes",
    window: "now",
    read: "sql",
    env: "LH_QUOTA_SUPABASE_STORAGE_BYTES",
    limitSource: "Supabase Pro: 100 GB file storage included (pricing page; not re-read 2026-09-23). Measured: sum(metadata->>'size') over storage.objects.",
  },
  {
    id: "supabase.edge_invocations",
    service: "Supabase",
    name: "Edge function invocations (last 24h x 30)",
    limit: PLAN_LIMITS.supabase_edge_invocations_month.value,
    unit: "invocations/month",
    window: "trailing 24h, projected to 30 days",
    read: "logs",
    env: "LH_QUOTA_SUPABASE_EDGE_INVOCATIONS",
    limitSource: "Supabase Pro: 2,000,000 edge function invocations/month included (pricing page; not re-read 2026-09-23). Measured: count(*) from function_edge_logs over 24h, times 30 (the billing-cycle total has no API).",
  },
  {
    id: "supabase.egress",
    service: "Supabase",
    name: "Egress",
    limit: PLAN_LIMITS.supabase_egress_bytes_month.value,
    unit: "bytes/month",
    window: "billing cycle",
    read: null,
    env: "LH_QUOTA_SUPABASE_EGRESS_BYTES",
    why: "No readable API. Measured 2026-09-14 (supabase-usage.yml run 34881959722): every Management API usage route (/v1/projects/{ref}/usage, /billing/usage, /v1/organizations/{slug}/usage) returns 404, and egress is not in the project's Prometheus scrape. Only the dashboard's Usage page shows it.",
    limitSource: "Supabase Pro: 250 GB egress/month included (pricing page; not re-read 2026-09-23).",
  },
  {
    id: "supabase.realtime_messages",
    service: "Supabase",
    name: "Realtime messages",
    limit: PLAN_LIMITS.supabase_realtime_messages_month.value,
    unit: "messages/month",
    window: "billing cycle",
    read: null,
    env: "LH_QUOTA_SUPABASE_REALTIME_MESSAGES",
    why: "No readable API: same 404 on every Management API usage route (2026-09-14), and Realtime runs outside Postgres, so no SQL can count its messages. Only the dashboard's Usage page shows it.",
    limitSource: "Supabase Pro: 5,000,000 Realtime messages/month included (pricing page; not re-read 2026-09-23).",
  },
  {
    id: "vercel.deploys_per_day",
    service: "Vercel",
    name: "Deployments created (last 24h)",
    limit: PLAN_LIMITS.vercel_deploys_per_day.value,
    unit: "deployments/day",
    window: "trailing 24h",
    read: "github",
    env: "LH_QUOTA_VERCEL_DEPLOYS_PER_DAY",
    limitSource: "Vercel Hobby: 100 deployments created per day (limits page; not re-read 2026-09-23). Hit for real on 2026-09-13 (\"Deployment rate limited — retry in 24 hours\", scripts/check-deploy-budget.mjs). Measured: GitHub deployments (every environment) Vercel's Git integration created in the last 24h; a CLI deploy creates none, so this is a floor.",
  },
  {
    id: "resend.sends_month",
    service: "Resend",
    name: "Emails sent this calendar month",
    limit: PLAN_LIMITS.resend_emails_month.value,
    unit: "emails/month",
    window: "calendar month to date (UTC)",
    read: "sql",
    env: "LH_QUOTA_RESEND_MONTHLY",
    limitSource: "Resend free plan: 3,000 emails/month (ASSUMED: the owner said only 'Resend has plan limits'; override with LH_QUOTA_RESEND_MONTHLY). Measured: email_send_log rows with status 'sent' (app mail only; Supabase Auth mail sent over SMTP is not logged there, so this is a floor).",
  },
  {
    id: "resend.sends_day",
    service: "Resend",
    name: "Emails sent (last 24h)",
    limit: PLAN_LIMITS.resend_emails_day.value,
    unit: "emails/day",
    window: "trailing 24h",
    read: "sql",
    env: "LH_QUOTA_RESEND_DAILY",
    limitSource: "Resend free plan: 100 emails/day (ASSUMED as above; override with LH_QUOTA_RESEND_DAILY). Same floor caveat as the monthly row.",
  },
  {
    id: "sentry.errors_30d",
    service: "Sentry",
    name: "Error events accepted (last 30 days)",
    limit: PLAN_LIMITS.sentry_errors_month.value,
    unit: "errors/month",
    window: "trailing 30 days",
    read: "sentry",
    env: "LH_QUOTA_SENTRY_ERRORS",
    limitSource: "Sentry Developer plan: 5,000 errors/month (ASSUMED: the owner said only 'Sentry has plan limits'; override with LH_QUOTA_SENTRY_ERRORS). Measured: Sentry stats for this project, outcome accepted.",
  },
  {
    id: "sentry.replays_30d",
    service: "Sentry",
    name: "Session replays sent: accepted + dropped by quota (last 30 days)",
    limit: PLAN_LIMITS.sentry_replays_month.value,
    unit: "replays/month",
    window: "trailing 30 days",
    read: "sentry",
    env: "LH_QUOTA_SENTRY_REPLAYS",
    limitSource: "Sentry Developer plan: 50 replays/month (ASSUMED; override with LH_QUOTA_SENTRY_REPLAYS). Measured: org stats_v2 category=replay, outcomes accepted + rate_limited, so a quota that is already refusing replays reads OVER instead of looking flat at the cap (Q275).",
  },
];

/** The limit in force for a quota: its env override, else the live limit, else the table. */
export function effectiveLimit(q, env = {}, live = {}) {
  const raw = env[q.env];
  if (raw != null && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const l = live[q.id];
  if (typeof l === "number" && Number.isFinite(l) && l > 0) return l;
  return q.limit;
}

/**
 * The threshold maths. `used` and `limit` must both be finite, limit > 0,
 * used >= 0; anything else is unreadable (a limit of 0 or a negative count is
 * a broken read, not "0%").
 * @returns {{status: "ok"|"warn"|"over"|"unreadable", pct: number|null}}
 */
export function grade(used, limit, warnAt = WARN_AT) {
  if (typeof used !== "number" || !Number.isFinite(used) || used < 0) return { status: "unreadable", pct: null };
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) return { status: "unreadable", pct: null };
  const ratio = used / limit;
  const pct = Math.round(ratio * 1000) / 10;
  if (ratio >= 1) return { status: "over", pct };
  if (ratio >= warnAt) return { status: "warn", pct };
  return { status: "ok", pct };
}

const fmt = (n, unit) => {
  if (n == null) return "—";
  if (/bytes/.test(unit)) return n >= GB ? `${(n / GB).toFixed(2)} GB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
  return Math.round(n).toLocaleString("en-US");
};

/**
 * @param {Record<string, {value?: number, error?: string}>} readings  by quota id
 * @param {{env?: Record<string,string|undefined>, live?: Record<string, number>, warnAt?: number, quotas?: any[]}} opts
 */
export function evaluateQuotas(readings, opts = {}) {
  const { env = {}, live = {}, warnAt = WARN_AT, quotas = QUOTAS } = opts;
  const rows = [];
  for (const q of quotas) {
    const limit = effectiveLimit(q, env, live);
    if (q.read === null) {
      rows.push({ q, limit, used: null, status: "not-monitored", pct: null, note: q.why });
      continue;
    }
    const r = readings[q.id];
    if (!r || r.error || typeof r.value !== "number") {
      rows.push({ q, limit, used: null, status: "unreadable", pct: null, note: r?.error ?? "no reading was taken" });
      continue;
    }
    const g = grade(r.value, limit, warnAt);
    rows.push({
      q, limit, used: r.value, status: g.status, pct: g.pct,
      note: g.status === "unreadable" ? `bad reading (used=${r.value}, limit=${limit})` : r.note ?? "",
    });
  }
  const alerts = rows.filter((r) => r.status === "warn" || r.status === "over");
  const unreadable = rows.filter((r) => r.status === "unreadable");
  const notMonitored = rows.filter((r) => r.status === "not-monitored");
  const summary = [
    unreadable.length ? `UNREADABLE ${unreadable.length}: ${unreadable.map((r) => r.q.name).join(", ")}` : null,
    alerts.length ? `ALERT ${alerts.length}: ${alerts.map((r) => `${r.q.service} ${r.q.name} ${r.pct}%`).join(", ")}` : null,
    `${rows.filter((r) => r.status === "ok").length} under ${Math.round(warnAt * 100)}%`,
    notMonitored.length ? `${notMonitored.length} NOT MONITORED (no API)` : null,
  ].filter(Boolean).join("; ");

  const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  const report = [
    "## Quota and limit monitor (Q63)",
    "",
    `**${summary}**`,
    "",
    `Alert at ${Math.round(warnAt * 100)}% of a limit (ledger warning), at 100% (ledger error). Unreadable = red run.`,
    "",
    "| Service | Quota | Used | Limit | % | Status | Window | Note |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((r) =>
      `| ${r.q.service} | ${esc(r.q.name)} | ${fmt(r.used, r.q.unit)} | ${fmt(r.limit, r.q.unit)} ${r.q.unit.replace(/^bytes/, "")} | ` +
      `${r.pct == null ? "—" : `${r.pct}%`} | **${r.status.toUpperCase()}** | ${esc(r.q.window)} | ${esc(r.note)} |`),
    "",
    "### Where each limit comes from",
    "",
    ...rows.map((r) => `- **${r.q.service} ${esc(r.q.name)}** — ${esc(r.q.limitSource)} Override: \`${r.q.env}\`.`),
    "",
    notMonitored.length
      ? `**NOT MONITORED (${notMonitored.length})** — not zero and not fine; nothing this repo can call reports them: ${notMonitored.map((r) => `${r.q.service} ${r.q.name}`).join(", ")}. Check the vendor dashboard.`
      : "",
  ].join("\n");

  return { rows, alerts, unreadable, notMonitored, summary, report };
}

/** Ledger title for an alert: stable per quota, so repeats bump one item. */
export const alertTitle = (row) => `Quota: ${row.q.service} ${row.q.name} at or above ${Math.round(WARN_AT * 100)}% of its limit`;
/** Ledger title for an unreadable quota. */
export const unreadableTitle = (row) => `Quota monitor cannot read: ${row.q.service} ${row.q.name}`;
