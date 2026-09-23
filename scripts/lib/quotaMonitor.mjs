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

/** @type {import("./quotaMonitor.d.mts").Quota[]} */
export const QUOTAS = [
  {
    id: "supabase.db_size",
    service: "Supabase",
    name: "Database size",
    limit: 8 * GB,
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
    limit: 100 * GB,
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
    limit: 2_000_000,
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
    limit: 250 * GB,
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
    limit: 5_000_000,
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
    limit: 100,
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
    limit: 3_000,
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
    limit: 100,
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
    limit: 5_000,
    unit: "errors/month",
    window: "trailing 30 days",
    read: "sentry",
    env: "LH_QUOTA_SENTRY_ERRORS",
    limitSource: "Sentry Developer plan: 5,000 errors/month (ASSUMED: the owner said only 'Sentry has plan limits'; override with LH_QUOTA_SENTRY_ERRORS). Measured: Sentry stats for this project, outcome accepted.",
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
