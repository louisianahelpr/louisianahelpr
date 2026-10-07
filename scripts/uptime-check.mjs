#!/usr/bin/env node
/**
 * Is the app up, right now, for a stranger? (uptime.yml's half.)
 *
 * Owner-approved 2026-09-14. Two questions, asked every 10 minutes:
 *   1. does https://www.louisianahelpr.com/ answer 200?
 *   2. does the database answer a read the app itself makes —
 *      `open_jobs_browse?select=id&limit=1` — with 200 inside 10s AND at
 *      least one row? An empty marketplace is never "up".
 *
 * The check itself lives in scripts/lib/uptimeProbe.mjs, shared with the
 * off-GitHub watcher api/uptime-heartbeat.ts (a Vercel Cron, Q936: GitHub
 * throttles this workflow's every-10-minute schedule to hours apart). This file reads the
 * environment, runs it, and writes the workflow's outputs and report.
 *
 * The second question is the point. Prod went down for a day on 2026-09-13
 * and nothing told anyone; a static-host GET stays 200 through a total
 * database outage (Vercel serves index.html from the CDN).
 *
 * PROD LOAD: this is NOT a test suite. Per run it is one HTML GET and one
 * single-row indexed select, both anonymous, both through the same public
 * view a logged-out visitor hits on /browse. It is exempt by name from the
 * >= 90 min cron spacing rule in src/test/prodWorkflowSpacing.test.ts for that
 * reason, and runs in its own concurrency group so it can never cancel a
 * queued suite.
 *
 * Exit code is always 0: the caller decides what to do with the verdict.
 * Outputs (GITHUB_OUTPUT): status=up|down|empty, summary=<one line>.
 *   up     the site answered, and the database returned at least one row
 *   down   the site or the database did not answer (critical; pages)
 *   empty  both answered, but every failure in the failed rounds was the
 *          database's ZERO-row answer: an empty guest marketplace, not an
 *          outage. Before launch it is its own WARNING ledger item; see
 *          EMPTY_IS_WARNING_BEFORE_LAUNCH in scripts/lib/uptimeProbe.mjs.
 * Writes uptime-report.md when down.
 *
 * Env:
 *   SITE_URL                        default https://www.louisianahelpr.com/
 *   REST_PROBE_PATH                 default /rest/v1/open_jobs_browse?select=id&limit=1
 *   SUPABASE_URL                    required for the REST probe
 *   SUPABASE_PUBLISHABLE_KEY        required for the REST probe
 *   ROUNDS / ROUND_GAP_MS / TIMEOUT_MS  overridable for the failure-path proof
 *   UPTIME_EMPTY_IS_DOWN=1          the launch-day verdict (empty is down), for
 *                                   the test that proves both settings
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { runUptime, EMPTY_IS_WARNING_BEFORE_LAUNCH as LAUNCH_SETTING } from "./lib/uptimeProbe.mjs";

const SITE_URL = process.env.SITE_URL || "https://www.louisianahelpr.com/";
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "";
// Spelled out in the workflow too (REST_PROBE_PATH), so the prod-hitting
// derivation in src/test/prodWorkflowSpacing.test.ts can SEE that this
// workflow talks to PostgREST rather than having to trust a comment.
const REST_PATH = process.env.REST_PROBE_PATH || "/rest/v1/open_jobs_browse?select=id&limit=1";
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 10_000);
const ROUNDS = Number(process.env.ROUNDS || 3);
const ROUND_GAP_MS = Number(process.env.ROUND_GAP_MS || 30_000);

// The launch-day switch is ONE constant for both watchers (scripts/lib/
// uptimeProbe.mjs); UPTIME_EMPTY_IS_DOWN=1 forces the launch verdict here.
const EMPTY_IS_WARNING_BEFORE_LAUNCH = process.env.UPTIME_EMPTY_IS_DOWN === "1" ? false : LAUNCH_SETTING;

const { status, summary, history } = await runUptime({
  siteUrl: SITE_URL,
  supabaseUrl: SUPABASE_URL,
  key: KEY,
  restPath: REST_PATH,
  timeoutMs: TIMEOUT_MS,
  rounds: ROUNDS,
  roundGapMs: ROUND_GAP_MS,
  emptyIsWarning: EMPTY_IS_WARNING_BEFORE_LAUNCH,
  log: (line) => console.log(line),
});

console.log(summary);

if (status === "down") {
  const lines = [
    "## Production is not answering",
    "",
    `**${summary}**`,
    "",
    "| round | check | result |",
    "| --- | --- | --- |",
    ...history.flatMap((r, i) => r.results.map((x) => `| ${i + 1} | ${x.name} | ${x.ok ? "ok" : "**FAIL**"} — ${x.detail} |`)),
    "",
    `Site: ${SITE_URL}`,
    `Database: \`GET ${REST_PATH}\` (anonymous, one row, the same view /browse reads)`,
    "",
    "This stays open until a later run of the uptime check passes, which closes it automatically.",
  ];
  writeFileSync("uptime-report.md", lines.join("\n") + "\n");
}

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `status=${status}\nsummary=${summary.replace(/[\r\n]+/g, " ")}\n`);
}
