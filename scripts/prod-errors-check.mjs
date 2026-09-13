#!/usr/bin/env node
/**
 * prod-errors-check — did a real user hit an error screen in the last window?
 *
 * Run every 15 minutes by .github/workflows/prod-errors.yml. Reads
 * public.error_logs through the Supabase Management API (the same
 * SUPABASE_ACCESS_TOKEN the drift/backup workflows already hold — no new
 * secret, no DB password on a runner) and decides whether the owner needs an
 * issue:
 *
 *   SURFACE  any boundary / boot-failure / error-screen row from a user who
 *            is not a seed or test account. One is enough: a person saw a
 *            broken screen.
 *   SPIKE    failed requests (QueryCache, MutationCache, money.*, global
 *            handlers) from non-seed users at or above SPIKE_THRESHOLD in the
 *            window. Below that is background noise the Slack trigger
 *            already carries.
 *
 * Seed and test accounts are `profiles.is_seed = true` (every Playwright
 * account is); their rows never count, EXCEPT when INCLUDE_SEED=1 — the
 * fire drill, which inserts one row tagged `drill:true` under a seed account
 * and expects this check to see it.
 *
 * Output is deliberately PII-free: counts, source, screen, a truncated
 * error message with anything email-shaped masked, and the release sha.
 * Never user ids, never urls with query strings, never stacks.
 *
 * Writes:  $GITHUB_OUTPUT  fire=true|false
 *          prod-errors-report.md   the issue body
 *          stdout                  the same report
 */
import { writeFileSync, appendFileSync } from "node:fs";

const REF = process.env.SUPABASE_PROJECT_REF;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const WINDOW_MIN = Number(process.env.WINDOW_MINUTES ?? 20); // 15-min cron + slack
const SPIKE_THRESHOLD = Number(process.env.SPIKE_THRESHOLD ?? 10);
const INCLUDE_SEED = process.env.INCLUDE_SEED === "1";

if (!REF || !TOKEN) {
  console.error("::error::SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN are required");
  process.exit(2);
}

// The surfaces src/test/errorSurfacesReport.test.tsx proves report with a
// `screen` tag. A person saw one of these.
export const SURFACE_SOURCES = [
  "RouteErrorBoundary",
  "ErrorBoundary",
  "SectionBoundary",
  "BootWatchdog",
  "ProtectedRoute.profileFetchError",
  "ErrorState",
];
// Failed requests: reported, but the user may have recovered with a retry.
export const REQUEST_SOURCES = [
  "QueryCache",
  "MutationCache",
  "window.onerror",
  "unhandledrejection",
];

const seedClause = INCLUDE_SEED
  ? "true"
  : "(e.user_id IS NULL OR e.user_id NOT IN (SELECT user_id FROM public.profiles WHERE is_seed))";

const inList = (xs) => xs.map((s) => `'${s.replace(/'/g, "''")}'`).join(",");

// Aggregated in SQL so no row-level data leaves the database.
const SQL = `
WITH w AS (
  SELECT e.severity, e.tags, e.message, e.context
  FROM public.error_logs e
  WHERE e.created_at > now() - interval '${WINDOW_MIN} minutes'
    AND ${seedClause}
),
classed AS (
  SELECT
    CASE
      WHEN tags->>'source' IN (${inList(SURFACE_SOURCES)}) THEN 'surface'
      WHEN tags->>'source' IN (${inList(REQUEST_SOURCES)}) OR tags->>'source' LIKE 'money.%' THEN 'request'
      ELSE 'other'
    END AS klass,
    COALESCE(tags->>'source','(none)') AS source,
    COALESCE(tags->>'screen', split_part(COALESCE(tags->>'route',''),'?',1), '') AS screen,
    left(regexp_replace(COALESCE(message,''), '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+', '<email>', 'g'), 160) AS message,
    COALESCE(tags->>'drill','') = 'true' AS drill,
    COALESCE(context->>'release', tags->>'release', '') AS release
  FROM w
)
SELECT klass, source, screen, message, drill, release, count(*)::int AS n
FROM classed
WHERE klass <> 'other'
GROUP BY 1,2,3,4,5,6
ORDER BY klass, n DESC
LIMIT 60`;

const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: SQL, read_only: true }),
});
if (!res.ok) {
  console.error(`::error::Management API query failed: ${res.status} ${await res.text()}`);
  process.exit(2);
}
const rows = await res.json();
if (!Array.isArray(rows)) {
  console.error(`::error::unexpected response shape: ${JSON.stringify(rows).slice(0, 300)}`);
  process.exit(2);
}

const surface = rows.filter((r) => r.klass === "surface");
const request = rows.filter((r) => r.klass === "request");
const surfaceN = surface.reduce((a, r) => a + r.n, 0);
const requestN = request.reduce((a, r) => a + r.n, 0);
const drill = rows.some((r) => r.drill);
const fire = surfaceN > 0 || requestN >= SPIKE_THRESHOLD;

const table = (rs) =>
  rs.length === 0
    ? "_none_"
    : ["| n | source | screen | message | release |", "|--:|---|---|---|---|",
       ...rs.map((r) => `| ${r.n} | \`${r.source}\` | \`${r.screen || "?"}\` | ${r.message.replace(/\|/g, "\\|")}${r.drill ? " **(drill)**" : ""} | ${r.release ? r.release.slice(0, 7) : "—"} |`),
      ].join("\n");

const now = new Date().toISOString();
const report = [
  `## prod-errors — ${now}`,
  "",
  `Window: last ${WINDOW_MIN} minutes · seed/test accounts ${INCLUDE_SEED ? "INCLUDED (drill)" : "excluded"} · spike threshold ${SPIKE_THRESHOLD}`,
  "",
  `**Error screens shown to real users: ${surfaceN}**${surfaceN ? " 🔴" : " ✅"}`,
  "",
  table(surface),
  "",
  `**Failed requests: ${requestN}**${requestN >= SPIKE_THRESHOLD ? " 🔴 spike" : ""}`,
  "",
  table(request),
  "",
  drill ? "_This detection includes a fire-drill row (`tags.drill = true`)._" : "",
  "",
  "Rows: `error_logs` · Slack: `trg_error_logs_slack` posts each distinct message · Doc: `docs/audit/prod-monitoring.md`",
].join("\n");

console.log(report);
writeFileSync("prod-errors-report.md", report);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `fire=${fire}\nsurface=${surfaceN}\nrequest=${requestN}\ndrill=${drill}\n`);
}
console.log(`\nfire=${fire} surface=${surfaceN} request=${requestN} drill=${drill}`);
