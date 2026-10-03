#!/usr/bin/env node
/**
 * Is the app up, right now, for a stranger?
 *
 * Owner-approved 2026-09-14. Two questions, asked every 10 minutes:
 *   1. does https://www.louisianahelpr.com/ answer 200?
 *   2. does the database answer a read the app itself makes —
 *      `open_jobs_browse?select=id&limit=1` — with 200 inside 10s AND at
 *      least one row? An empty marketplace is never "up"; see probe()'s note.
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
 * Outputs (GITHUB_OUTPUT): status=up|down|empty, summary=<one line>.
 *   up     the site answered, and the database returned at least one row
 *   down   the site or the database did not answer (critical; pages)
 *   empty  both answered, but every failure in the failed rounds was the
 *          database's ZERO-row answer: an empty guest marketplace, not an
 *          outage. Before launch it is its own WARNING ledger item; see
 *          EMPTY_IS_WARNING_BEFORE_LAUNCH.
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

// Owner, 2026-10-02 ("Split the alert until launch"): prod has no funded jobs
// before launch (money states cannot be seeded while Stripe is live), so a
// database that answers 200 with ZERO rows reports status=empty, a WARNING,
// instead of paging "DOWN" as critical while the site is up. Set this to false
// on launch day (docs/OPEN.md launch checklist) and an empty marketplace is
// down again.
const EMPTY_IS_WARNING_BEFORE_LAUNCH = process.env.UPTIME_EMPTY_IS_DOWN === "1" ? false : true;

/**
 * One probe. Never throws: a thrown fetch IS the failure we are looking for.
 *
 * `expectRows`: a 200 carrying `[]` is NOT up.
 *
 * WHY (2026-09-21, nightly-red #1595). This probe asked PostgREST for
 * `open_jobs_browse?select=id&limit=1` and passed on the status code alone. An
 * empty array is a 200, so the guest marketplace could be completely dark and
 * every check in the repo stayed green — which is exactly what happened: the
 * only signal that prod had ZERO browsable jobs was e2e-journeys
 * 01-browse.spec.ts failing "guest Browse listed no jobs", twice a week, six
 * days after the fact. `open_jobs_browse` admits a row only at
 * payment_status in (escrow, payout_pending, released), so 115 open-but-
 * unfunded rows render a marketplace with nothing in it. A logged-out visitor
 * landing on /browse sees an empty page; that is never "up", whatever the
 * status line says. Reading the body is the whole fix. The zero-row answer is
 * flagged `empty` so the verdict can tell it apart from an outage (see
 * EMPTY_IS_WARNING_BEFORE_LAUNCH).
 */
async function probe(name, url, headers, { expectRows = false } = {}) {
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: ac.signal, redirect: "follow" });
    const ms = Date.now() - started;
    // A 200 that took longer than the budget is a failure too — the owner
    // cares about "usable", not "eventually answered".
    if (res.status !== 200) {
      // The body says WHY (PostgREST and the gateway name the cause: "Invalid
      // API key" = a rotated key, "permission denied for table jobs" = a lost
      // grant), and a bare "HTTP 401" cannot tell those apart. On 2026-10-03
      // the alert said only "HTTP 401" while the cause was 42501 (PR #2161).
      const why = (await res.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 160);
      return { name, ok: false, ms, detail: why ? `HTTP ${res.status}: ${why}` : `HTTP ${res.status}` };
    }
    if (ms > TIMEOUT_MS) return { name, ok: false, ms, detail: `200 but ${ms}ms > ${TIMEOUT_MS}ms` };
    if (expectRows) {
      let rows;
      try {
        rows = await res.json();
      } catch (e) {
        return { name, ok: false, ms, detail: `200 but the body is not JSON (${String(e?.message || e).slice(0, 80)})` };
      }
      if (!Array.isArray(rows)) return { name, ok: false, ms, detail: "200 but the body is not a row array" };
      if (rows.length === 0) {
        return { name, ok: false, empty: true, ms, detail: `200 in ${ms}ms but ZERO rows — a guest opening /browse sees an empty marketplace` };
      }
      return { name, ok: true, ms, detail: `200 in ${ms}ms, ${rows.length} row(s)` };
    }
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
      probe(
        "database",
        `${SUPABASE_URL}${REST_PATH}`,
        {
          apikey: KEY,
          authorization: `Bearer ${KEY}`,
          accept: "application/json",
        },
        // Zero rows is never up — see probe()'s note.
        { expectRows: true },
      ),
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
// Empty, not down, only when EVERY failure in the failed rounds was the
// database's zero-row answer, i.e. the site and the database both responded.
// Any other failure in those rounds (a timeout, a 5xx, the site) is an outage.
const onlyEmpty = history.slice(-consecutive).every((r) => r.results.every((x) => x.ok || x.empty));
const status = !down ? "up" : onlyEmpty && EMPTY_IS_WARNING_BEFORE_LAUNCH ? "empty" : "down";
const summary =
  status === "down"
    ? `DOWN — ${failing.map((r) => `${r.name}: ${r.detail}`).join(", ")} (${consecutive} consecutive failed rounds)`
    : status === "empty"
      ? `EMPTY — the site and the database answer, but open_jobs_browse returned ZERO rows in ${consecutive} consecutive rounds: no funded job is browsable (pre-launch, owner 2026-10-02)`
      : `up — ${last.results.map((r) => `${r.name} ${r.detail}`).join(", ")}`;

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
  appendFileSync(process.env.GITHUB_OUTPUT, `status=${status}\nsummary=${summary.replace(/\n/g, " ")}\n`);
}
