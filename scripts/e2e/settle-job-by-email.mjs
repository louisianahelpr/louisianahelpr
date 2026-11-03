#!/usr/bin/env node
/**
 * Settle ONE hired-and-funded test job forward, holding the two seats named by
 * email (Q2073).
 *
 * settle-stranded-escrow.mjs holds only poster-e2e and helper-e2e, so a test
 * job between two OTHER test accounts is skipped forever. Measured 2026-11-03
 * (read-only SQL): 6e7dd687-92fe-475b-826d-01b2c6f18b66 "[E2E DO NOT ACCEPT] fa
 * l3zlb", is_seed, in_progress/escrow since 2026-10-30, cs_test_ session,
 * posted by helpr-journey-throwaway-mvvl3zu5d74927@mailinator.com and hired
 * helpr-journey-throwaway-mvvl42gd59f842@mailinator.com (both is_seed and in
 * public.test_accounts).
 *
 * Both sessions come from scripts/lib/adminSession.mjs mintAdminSession, which
 * signs in only test accounts (Q1422, Q2398). The walk is settleJobForward,
 * which refuses (and calls nothing) unless the row is is_seed, owned by exactly
 * these two seats, funded into escrow through a cs_test_ Checkout Session,
 * hired, and not disputed. --dry-run mints the two sessions, reads the row and
 * prints what it would do; it calls no RPC, edge function or write.
 *
 * Usage (service role from SUPABASE_SERVICE_ROLE_KEY or ./.env):
 *   node scripts/e2e/settle-job-by-email.mjs --job <uuid> --poster-email <a> --helper-email <b> [--dry-run]
 */
import { settleJobForward, settleRefusalReason, readJobRow } from "./settleForward.mjs";
import { mintAdminSession, resolveServiceKey, PUBLIC_ANON_KEY, DEFAULT_SUPABASE_URL } from "../lib/adminSession.mjs";
import { assertFreshCheckout } from "../lib/freshCheckout.mjs";

// Refuse to write prod from a stale checkout (Q?stale-shared-checkout-writes).
assertFreshCheckout(import.meta.url);

const BASE = (process.env.PLAYWRIGHT_SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, "");
const ANON = process.env.PLAYWRIGHT_SUPABASE_ANON_KEY || PUBLIC_ANON_KEY;
const DRY = process.argv.includes("--dry-run");

function argOf(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const JOB = argOf("--job");
const POSTER_EMAIL = argOf("--poster-email");
const HELPER_EMAIL = argOf("--helper-email");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (!JOB || !UUID.test(JOB) || !POSTER_EMAIL || !HELPER_EMAIL) {
  console.error("FAIL: usage: settle-job-by-email.mjs --job <uuid> --poster-email <email> --helper-email <email> [--dry-run]");
  process.exit(1);
}
if (POSTER_EMAIL.trim().toLowerCase() === HELPER_EMAIL.trim().toLowerCase()) {
  console.error("FAIL: the poster and the helper must be two different accounts.");
  process.exit(1);
}
const serviceKey = resolveServiceKey();
if (!serviceKey) {
  console.error("FAIL: no service-role key (SUPABASE_SERVICE_ROLE_KEY or ./.env) to mint the two test sessions with.");
  process.exit(1);
}

const mint = (email) => mintAdminSession({ email, serviceKey, supabaseUrl: BASE, anonKey: ANON });
const poster = await mint(POSTER_EMAIL);
const helper = await mint(HELPER_EMAIL);
const seats = { posterId: poster.user.id, helperId: helper.user.id };

console.log(`Settle one job forward — ${BASE}${DRY ? "  (DRY RUN)" : ""}`);
console.log(`  poster ${POSTER_EMAIL} = ${seats.posterId}`);
console.log(`  helper ${HELPER_EMAIL} = ${seats.helperId}`);

const row = await readJobRow({ base: BASE, anon: ANON, posterToken: poster.access_token, jobId: JOB });
if (!row) {
  console.error(`FAIL: ${JOB} is not readable as ${POSTER_EMAIL} (no such job, or not this poster's).`);
  process.exit(1);
}
const refusal = settleRefusalReason(row, seats);
console.log(
  `  ${JOB}  ${row.status}/${row.payment_status}  session ${String(row.stripe_session_id ?? "none").slice(0, 8)}…  ` +
    `${refusal ? `REFUSED — ${refusal}` : "→ settle forward (arrival, proof photos, Done, release)"}`,
);
if (refusal) {
  // "already settled" is the success a rerun meets; anything else is a stop.
  process.exit(refusal === "already settled" ? 0 : 1);
}
if (DRY) {
  console.log("DRY RUN: nothing called. Re-run without --dry-run to settle it.");
  process.exit(0);
}

const out = await settleJobForward({
  base: BASE,
  anon: ANON,
  posterToken: poster.access_token,
  helperToken: helper.access_token,
  posterId: seats.posterId,
  helperId: seats.helperId,
  jobId: JOB,
  log: (line) => console.log(line),
});
console.log(`\nsettled=${out.settled} status=${out.status} payment=${out.paymentStatus} steps=${out.steps.join(" > ") || "(none)"}`);
if (!out.settled) {
  console.error(`FAIL: ${JOB} did not settle: ${out.reason}`);
  process.exit(1);
}
