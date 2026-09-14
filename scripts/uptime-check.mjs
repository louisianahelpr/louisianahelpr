#!/usr/bin/env node
/**
 * Is the app up, right now, for a stranger?
 *
 * Owner-approved 2026-09-14. Two questions, asked every 10 minutes:
 *   1. does https://www.louisianahelpr.com/ answer 200?
 *   2. does the database answer a read the app itself makes —
 *      `open_jobs_browse?select=id&limit=1` — with 200 inside 10s?
 *
 * The second one is the point. Prod is a free-tier t4g.nano; on 2026-09-13 it
 * went down for a day and nothing told anyone. A static-host GET stays 200
 * through a total database outage (Vercel serves index.html from the CDN), so
 * a site-only ping would have reported green for the whole outage.
 *
 * PROD LOAD: this is NOT a test suite. Per run it is one HTML GET and one
 * single-row indexed select, both anonymous, both through the same public
 * view a logged-out visitor hits on /browse. That is ~6 reads an hour — far
 * less than one page view. It is exempt by name from the >= 90 min cron
 * spacing rule in src/test/prodWorkflowSpacing.test.ts for that reason, and
 * runs in its own concurrency group so it can never cancel a queued suite.
 *
 * TWO CONSECUTIVE FAILURES, not one: a single blip (a cold lambda, one
 * dropped TCP connection) must not page anyone. Rather than carry state
 * between runs, one run probes up to three ROUNDS, 30s apart, and only
 * reports down when two consecutive rounds both fail. That is a real
 * "consecutive failures" test and it fires within ~1 minute instead of
 * waiting out another 10-minute cron tick.
 *
 * Exit code is always 0: the caller decides what to do with the verdict.
 * Outputs (GITHUB_OUTPUT): status=up|down, summary=<one line>.
 * Writes uptime-report.md when down.
 *
 * Env:
 *   SITE_URL                        default https://www.louisianahelpr.com/
 *   REST_PROBE_PATH                 default /rest/v1/open_jobs_browse?select=id&limit=1
 *   SUPABASE_URL                    required for the REST probe
 *   SUPABASE_PUBLISHABLE_KEY        required for the REST probe
 *   ROUNDS / ROUND_GAP_MS / TIMEOUT_MS  overridable for the failure-path proof
 */
import { appendFileSync, writeFileSync } from "node:fs";

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

/** One probe. Never throws: a thrown fetch IS the failure we are looking for. */
async function probe(name, url, headers) {
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: ac.signal, redirect: "follow" });
    const ms = Date.now() - started;
    // A 200 that took longer than the budget is a failure too — the owner
    // cares about "usable", not "eventually answered".
    if (res.status !== 200) return { name, ok: false, ms, detail: `HTTP ${res.status}` };
    if (ms > TIMEOUT_MS) return { name, ok: false, ms, detail: `200 but ${ms}ms > ${TIMEOUT_MS}ms` };
    return { name, ok: true, ms, detail: `200 in ${ms}ms` };
  } catch (e) {
    return { name, ok: false, ms: Date.now() - started, detail: (e?.name === "AbortError" ? `no answer in ${TIMEOUT_MS}ms` : String(e?.message || e)) };
  } finally {
    clearTimeout(timer);
  }
}

async function round() {
  const checks = [probe("site", SITE_URL, { "user-agent": "louisianahelpr-uptime/1" })];
  if (SUPABASE_URL && KEY) {
    checks.push(
      probe("database", `${SUPABASE_URL}${REST_PATH}`, {
        apikey: KEY,
        authorization: `Bearer ${KEY}`,
        accept: "application/json",
      }),
    );
  } else {
    // Never silently drop half the check: no key means we cannot answer the
    // question that matters, and saying "up" would be a lie.
    checks.push(Promise.resolve({ name: "database", ok: false, ms: 0, detail: "SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY not set" }));
  }
  const results = await Promise.all(checks);
  return { ok: results.every((r) => r.ok), results };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const history = [];
let consecutive = 0;
let down = false;
for (let i = 0; i < ROUNDS; i++) {
  if (i > 0) await sleep(ROUND_GAP_MS);
  const r = await round();
  history.push(r);
  console.log(`round ${i + 1}/${ROUNDS}: ${r.ok ? "ok" : "FAIL"} — ${r.results.map((x) => `${x.name} ${x.detail}`).join("; ")}`);
  if (r.ok) {
    consecutive = 0;
    break; // one good round is enough: nothing consecutive can follow it.
  }
  consecutive += 1;
  if (consecutive >= 2) {
    down = true;
    break;
  }
}

const last = history[history.length - 1];
const failing = last.results.filter((r) => !r.ok);
const summary = down
  ? `DOWN — ${failing.map((r) => `${r.name}: ${r.detail}`).join(", ")} (${consecutive} consecutive failed rounds)`
  : `up — ${last.results.map((r) => `${r.name} ${r.detail}`).join(", ")}`;

console.log(summary);

if (down) {
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
  appendFileSync(process.env.GITHUB_OUTPUT, `status=${down ? "down" : "up"}\nsummary=${summary.replace(/\n/g, " ")}\n`);
}
