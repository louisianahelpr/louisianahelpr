#!/usr/bin/env node
/**
 * App Store reviews that report a problem -> the ops alert ledger
 * (docs/OPEN.md Q289). Runs daily in quota-monitor.yml (store_reviews job).
 *
 *   node scripts/check-store-reviews.mjs [--no-ledger]
 *
 * Reads the App Store Connect API (GET /v1/apps?filter[bundleId],
 * GET /v1/apps/{id}/customerReviews, newest first) with the same ASC_* key the
 * TestFlight pipeline uses (scripts/asc/asc-client.mjs), and records every
 * review rated 3 stars or lower that is newer than the cursor as a
 * `user-report` ledger item (scripts/lib/storeReviews.mjs says which, and how
 * each is recorded once).
 *
 * Fails closed (exit 1, and a ledger error item so the owner sees it):
 * credentials missing, any ASC read failing (a 403 means the key's role cannot
 * read customer reviews: an OWNER step, named in the message), no app for the
 * bundle id, the cursor unreadable, a review unreadable, or a ledger write
 * refused. Zero new low-rated reviews is a true zero and exits 0.
 *
 * Google Play: there is no Android project in this repo, so there is nothing
 * to read. Add a Play reader here the day one ships.
 *
 * Test hooks: LH_ASC_API_BASE (App Store Connect host), LH_SUPABASE_API_BASE
 * (Management API). Never prints review text: the Actions log is public.
 */
import { appendFileSync } from "node:fs";
import { asc, mintToken } from "./asc/asc-client.mjs";
import { recordOpsAlert, sql } from "./lib/opsAlertLedger.mjs";
import { BUNDLE_ID_DEFAULT, CURSOR_SQL, ledgerItem, reportable, sinceFrom, toReview } from "./lib/storeReviews.mjs";

const env = process.env;
const ASC_BASE = env.LH_ASC_API_BASE ?? "https://api.appstoreconnect.apple.com";
const BUNDLE_ID = env.ASC_BUNDLE_ID || BUNDLE_ID_DEFAULT;
const noLedger = process.argv.includes("--no-ledger");
const runUrl = env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : null;

async function fail(message) {
  console.error(`::error::${message}`);
  if (!noLedger) {
    await recordOpsAlert({
      sourceKind: "workflow", source: "store-reviews", title: "App Store review ingest cannot run",
      severity: "error", sample: message, sampleRef: { run_url: runUrl },
      verifyKind: "workflow", verifyRef: "quota-monitor.yml",
    });
  }
  process.exit(1);
}

async function readCursor() {
  const rows = await sql(CURSOR_SQL, { readOnly: true });
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error(`cursor read returned ${Array.isArray(rows) ? rows.length : typeof rows} rows — refusing to report clean`);
  }
  return rows[0].cursor ?? null;
}

/** Newest first; stop paging once a page reaches reviews at or before `since`. */
async function readReviews(appId, token, since) {
  const out = [];
  let next = `${ASC_BASE}/v1/apps/${appId}/customerReviews?sort=-createdDate&limit=200`;
  while (next) {
    const page = await asc(next, { token });
    if (!page || !Array.isArray(page.data)) throw new Error("customerReviews returned no data array — refusing to report clean");
    const reviews = page.data.map(toReview);
    out.push(...reviews);
    const oldest = reviews.at(-1);
    if (!oldest || Date.parse(oldest.created) <= since.getTime()) break;
    next = page.links?.next ?? null;
  }
  return out;
}

async function main() {
  let token;
  try {
    token = mintToken();
  } catch (e) {
    return fail(`could not read App Store reviews: ${e.message}`);
  }

  let appId;
  try {
    const apps = await asc(`${ASC_BASE}/v1/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}`, { token });
    appId = apps?.data?.[0]?.id;
  } catch (e) {
    return fail(`could not read App Store reviews: ${e.message}`);
  }
  if (!appId) return fail(`could not read App Store reviews: no App Store app for bundle id ${BUNDLE_ID} — refusing to report clean`);

  let cursor;
  try {
    cursor = await readCursor();
  } catch (e) {
    return fail(`could not read the review cursor from the ops alert ledger: ${e.message}`);
  }
  const since = sinceFrom(cursor);

  let raw;
  try {
    raw = await readReviews(appId, token, since);
  } catch (e) {
    const owner = e.status === 403
      ? " OWNER STEP: the App Store Connect API key's role cannot read customer reviews; give the key a role with Customer Reviews access (Admin, App Manager or Customer Support) in App Store Connect > Users and Access > Integrations."
      : "";
    return fail(`could not read App Store reviews: ${e.message}${owner}`);
  }

  const { reviews, unreadable } = reportable(raw, since);
  let recorded = 0;
  const refused = [];
  if (!noLedger) {
    for (const r of reviews) {
      if (await recordOpsAlert(ledgerItem(r, appId))) recorded += 1;
      else refused.push(r.id);
    }
  }

  const summary = [
    "## App Store reviews (Q289)",
    "",
    `Read ${raw.length} review(s), newest first; counting those created after ${since.toISOString()} (${cursor ? "the cursor" : "first run, 14-day lookback"}).`,
    `${reviews.length} rated 3 stars or lower -> ${noLedger ? "not recorded (--no-ledger)" : `${recorded} recorded as user-report ledger items`}.`,
    "Review ids (text is in the ledger only): " + (reviews.map((r) => `${r.id} (${r.rating}/5)`).join(", ") || "none"),
  ].join("\n");
  console.log(summary);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary + "\n");

  if (unreadable.length) return fail(`${unreadable.length} App Store review(s) had no readable id, rating or date (${unreadable.map((r) => r.id || "?").join(", ")}) — refusing to report clean`);
  if (refused.length) return fail(`${refused.length} App Store review(s) were NOT recorded in the ledger: ${refused.join(", ")}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
