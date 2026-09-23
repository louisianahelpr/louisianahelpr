#!/usr/bin/env node
/**
 * Stripe TEST balance monitor (docs/OPEN.md Q3 / Q145), daily from the
 * `stripe-balance` job in .github/workflows/quota-monitor.yml. The threshold
 * maths, parser, SQL and alert text live in scripts/lib/stripeBalanceMonitor.mjs.
 *
 * Reads:
 *   1. Stripe GET /v1/balance with STRIPE_TEST_SECRET_KEY (the key
 *      stripe-webhook-guard.yml uses). The key must be sk_test_/rk_test_ and the
 *      answer livemode=false, or nothing is read. Never prints the key.
 *   2. The payouts due in the next 72h from public.jobs (payout_pending,
 *      payout_scheduled_at), one read-only statement through the Management
 *      API. If that read fails the $100 floor alone applies (::warning).
 *
 * available < max($100, 1.5 x upcoming) -> an error item in the ops alert
 * ledger whose text says how to top up in TEST mode; the run stays green (the
 * ledger is the alert). An UNREADABLE balance -> a ledger error AND exit 1.
 *
 * Env: STRIPE_TEST_SECRET_KEY, SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF.
 * Test seams: LH_STRIPE_API_BASE, LH_SUPABASE_API_BASE. --no-ledger skips
 * ledger writes.
 */
import { appendFileSync } from "node:fs";
import {
  LOW_TITLE, MULTIPLIER, TOP_UP_HOW, UNREADABLE_TITLE, UPCOMING_SQL, WINDOW_HOURS,
  dollars, evaluateBalance, lowSample, parseAvailableUsdCents,
} from "./lib/stripeBalanceMonitor.mjs";
import { recordOpsAlert } from "./lib/opsAlertLedger.mjs";

const env = process.env;
const STRIPE = env.LH_STRIPE_API_BASE ?? "https://api.stripe.com";
const SUPA = env.LH_SUPABASE_API_BASE ?? "https://api.supabase.com";
const noLedger = process.argv.includes("--no-ledger");

async function readBalance() {
  const key = env.STRIPE_TEST_SECRET_KEY;
  if (!key) throw new Error("STRIPE_TEST_SECRET_KEY is not set");
  if (!/^(sk|rk)_test_/.test(key)) {
    throw new Error("STRIPE_TEST_SECRET_KEY is not a test-mode key (expected sk_test_/rk_test_). Refusing to make any request — Stripe stays in sandbox until launch.");
  }
  const res = await fetch(`${STRIPE}/v1/balance`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    // A restricted key without "Balance: read" answers 403 here.
    throw new Error(`Stripe GET /v1/balance ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return parseAvailableUsdCents(await res.json());
}

async function readUpcoming() {
  const { SUPABASE_ACCESS_TOKEN: token, SUPABASE_PROJECT_REF: ref } = env;
  if (!token || !ref) throw new Error("SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF are not set");
  const res = await fetch(`${SUPA}/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: UPCOMING_SQL, read_only: true }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Management API SQL ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const rows = await res.json();
  const r = Array.isArray(rows) ? rows[0] : null;
  const cents = Number(r?.cents);
  const jobs = Number(r?.jobs);
  if (!r || !Number.isFinite(cents) || !Number.isFinite(jobs)) throw new Error(`the upcoming-payout SQL returned no usable row: ${JSON.stringify(rows).slice(0, 160)}`);
  return { cents, jobs };
}

async function main() {
  let availableCents = null;
  let balanceError = null;
  try {
    availableCents = await readBalance();
  } catch (e) {
    balanceError = `could not read the Stripe TEST balance: ${e?.message ?? e}`;
  }
  let upcoming = null;
  let upcomingError = null;
  try {
    upcoming = await readUpcoming();
  } catch (e) {
    upcomingError = `could not read payouts due in the next ${WINDOW_HOURS}h: ${e?.message ?? e}`;
  }

  const res = evaluateBalance({ availableCents, upcomingCents: upcoming?.cents ?? null });
  const lines = [
    "## Stripe TEST balance (Q3)",
    "",
    `- available: ${res.availableCents === null ? `**UNREADABLE** (${balanceError})` : dollars(res.availableCents)}`,
    `- due in ${WINDOW_HOURS}h: ${upcoming ? `${upcoming.jobs} job(s), up to ${dollars(upcoming.cents)}` : `unreadable (${upcomingError}); floor only`}`,
    `- threshold: ${res.threshold === null ? "n/a" : `${dollars(res.threshold)} = max($100, ${MULTIPLIER} x due)`}`,
    `- status: **${res.status.toUpperCase()}**`,
  ];
  const report = lines.join("\n");
  console.log(report);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, report + "\n");
  if (upcomingError) console.log(`::warning title=Upcoming payouts unreadable::${upcomingError}. Checked against the $100 floor only.`);

  const runUrl = env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : null;
  const common = { sourceKind: "workflow", source: "stripe-balance-monitor", verifyKind: "workflow", verifyRef: "quota-monitor.yml" };

  if (res.status === "unreadable") {
    const sample = `${balanceError}. Nothing can warn before payouts fail until this reads. If the key lacks "Balance: read", add it to the restricted key. ${TOP_UP_HOW}`;
    if (!noLedger) await recordOpsAlert({ ...common, title: UNREADABLE_TITLE, severity: "error", sample, sampleRef: { run_url: runUrl } });
    console.error(`::error title=Stripe balance unreadable::${balanceError}`);
    console.error("::error::The Stripe TEST balance could not be read — this run is red on purpose.");
    process.exit(1);
  }
  if (res.status === "low") {
    const sample = lowSample(res, upcoming?.jobs ?? null);
    if (!noLedger) {
      await recordOpsAlert({
        ...common, title: LOW_TITLE, severity: "error", sample,
        sampleRef: { run_url: runUrl, available_cents: res.availableCents, threshold_cents: res.threshold, upcoming_cents: res.upcomingCents },
      });
    }
    console.log(`::warning title=Stripe TEST balance low::${sample}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
