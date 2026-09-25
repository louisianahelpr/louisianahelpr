#!/usr/bin/env node
/**
 * DR-006, after a database restore to time T: every PaymentIntent, transfer and
 * refund Stripe created since T, looked up BY ID in the database. Anything
 * Stripe has and the database does not is money that moved while the restored
 * database says it did not. A transfer in that list is a helper who would be
 * paid twice when the payout crons are switched back on
 * (docs/runbooks/restore-from-backup.md §5).
 *
 * The opposite direction (a row whose state disagrees with Stripe) is what the
 * daily `money-reconciliation` function checks; the runbook runs both.
 *
 * READ-ONLY. Stripe: GET list endpoints only. Database: PostgREST GET only.
 * Refuses a key whose mode differs from --mode (default test: Stripe stays in
 * SANDBOX until launch).
 *
 * Usage:
 *   node scripts/check-stripe-restore-drift.mjs --since <ISO-8601 | epoch s> [--mode test|live] [--json <file>]
 * Env: STRIPE_TEST_SECRET_KEY (test) or STRIPE_SECRET_KEY (live);
 *      SUPABASE_URL or SUPABASE_PROJECT_REF, SUPABASE_SERVICE_ROLE_KEY (the RESTORED project);
 *      LH_STRIPE_API_BASE (tests only).
 * Exit: 0 every money object since T has its row; 1 some do not (listed);
 *       2 could not measure.
 */
import { writeFileSync } from "node:fs";
import { DB_ID_COLUMNS, STRIPE_LISTS, gradeKind, isStripeList, keyForMode, parseSince } from "./lib/stripeRestoreReconcile.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const unmeasured = (msg) => {
  console.error(`::error::check-stripe-restore-drift: could not reconcile: ${msg}`);
  process.exit(2);
};

let SINCE;
let STRIPE_KEY;
const MODE = opt("mode", "test");
try {
  SINCE = parseSince(opt("since", ""));
  STRIPE_KEY = keyForMode(MODE, process.env);
} catch (e) {
  unmeasured(e.message);
}
const JSON_OUT = opt("json", null);
const STRIPE_BASE = (process.env.LH_STRIPE_API_BASE || "https://api.stripe.com").replace(/\/+$/, "");

const DB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DB_BASE = (
  process.env.SUPABASE_URL || (process.env.SUPABASE_PROJECT_REF ? `https://${process.env.SUPABASE_PROJECT_REF}.supabase.co` : "")
).replace(/\/+$/, "");
if (!DB_KEY || !DB_BASE) unmeasured("SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL/SUPABASE_PROJECT_REF are required");

async function getJson(url, headers) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20_000);
  try {
    const res = await fetch(url, { headers, signal: ctl.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`GET ${url.split("?")[0]} → ${res.status} ${text.slice(0, 160)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(t);
  }
}

// 1. Stripe: every object of each kind created at or after T.
const stripe = {};
for (const [kind, path] of Object.entries(STRIPE_LISTS)) {
  const all = [];
  let after = null;
  for (let page = 0; ; page++) {
    if (page >= 200) unmeasured(`${path}: more than 20,000 objects since T — narrow --since or raise the cap deliberately`);
    const qs = new URLSearchParams({ limit: "100", "created[gte]": String(SINCE) });
    if (after) qs.set("starting_after", after);
    let body;
    try {
      body = await getJson(`${STRIPE_BASE}${path}?${qs}`, { Authorization: `Bearer ${STRIPE_KEY}` });
    } catch (e) {
      unmeasured(`Stripe ${e.message}`);
    }
    if (!isStripeList(body)) unmeasured(`Stripe ${path} did not return a list object — refusing to report clean`);
    all.push(...body.data);
    if (!body.has_more || body.data.length === 0) break;
    after = body.data[body.data.length - 1].id;
  }
  stripe[kind] = all;
}

// 2. Database: every id of each kind, in every column that records it.
const H = { apikey: DB_KEY, Authorization: `Bearer ${DB_KEY}` };
const dbIds = {};
const dbCounts = {};
for (const [kind, cols] of Object.entries(DB_ID_COLUMNS)) {
  const ids = new Set();
  for (const { table, column } of cols) {
    let n = 0;
    for (let offset = 0; ; offset += 1000) {
      let page;
      try {
        page = await getJson(`${DB_BASE}/rest/v1/${table}?select=${column}&${column}=not.is.null&order=id.asc&limit=1000&offset=${offset}`, H);
      } catch (e) {
        unmeasured(`database ${table}.${column}: ${e.message}`);
      }
      if (!Array.isArray(page)) unmeasured(`database ${table}.${column} did not return rows`);
      for (const r of page) if (r[column]) ids.add(r[column]);
      n += page.length;
      if (page.length < 1000) break;
    }
    dbCounts[`${table}.${column}`] = n;
  }
  dbIds[kind] = ids;
}
if (Object.values(dbCounts).every((n) => n === 0)) {
  unmeasured(`read ${Object.keys(dbCounts).length} Stripe-id columns and every one was empty — refusing to report clean (the restored database should hold paid jobs)`);
}

// 3. Grade.
const iso = (s) => new Date(s * 1000).toISOString();
const report = {};
let missing = 0;
console.log(`Stripe (${MODE} mode) objects created since ${iso(SINCE)}, looked up by id in ${new URL(DB_BASE).host}:`);
for (const kind of Object.keys(STRIPE_LISTS)) {
  const g = gradeKind(kind, stripe[kind], dbIds[kind]);
  report[kind] = g;
  missing += g.missing.length;
  console.log(
    `  ${kind.padEnd(15)} ${String(stripe[kind].length).padStart(5)} in Stripe: ${g.matched} matched, ${g.missing.length} NOT IN DB, ` +
      `${g.unlinkable.length} not id-linked by design, ${g.ignored} not money (abandoned/failed)`,
  );
}
for (const kind of Object.keys(report)) {
  const g = report[kind];
  if (g.missing.length) {
    console.log(`\n${kind.toUpperCase()} in Stripe with no database row:`);
    for (const m of g.missing) console.log(`  ${m.id}  ${m.amount ?? "?"}¢  ${iso(m.created)}  ${m.status ?? ""}${m.reversed ? " reversed" : ""}  ${m.hint}`);
  }
  if (g.unlinkable.length) {
    console.log(`\n${kind} not recorded by id (check by hand):`);
    for (const u of g.unlinkable) console.log(`  ${u.id}  ${u.amount ?? "?"}¢  ${iso(u.created)}  ${u.why}  ${u.hint}`);
  }
}
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ mode: MODE, since: iso(SINCE), dbCounts, report }, null, 2));

if (missing) {
  console.error(`::error::${missing} Stripe money object(s) since ${iso(SINCE)} have no database row. Keep every money cron switched off until each is reconciled.`);
  process.exit(1);
}
console.log(`\nOK — every Stripe money object since ${iso(SINCE)} has its database row.`);
