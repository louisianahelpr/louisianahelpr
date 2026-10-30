#!/usr/bin/env node
/**
 * jobPayoutProof: ONE Helpr job, end to end on prod in Stripe TEST mode, until
 * the Helpr's payout lands as a Stripe transfer on a test connected account,
 * then one tip (owner chose this 2026-10-30, OPS-6 / D4-1, one run).
 * The account pattern and every safety rule are declutterPayoutProof.mjs's,
 * reused from there, on the same throwaway shape: run-owned @mailinator.com
 * accounts, is_seed, enrolled in test_accounts, a Custom TEST account the run
 * makes, linked to the run's own Helpr, ALWAYS unlinked at the end. helper-e2e
 * and the fixture acct_1UQigP3qNyg1xGcp are never touched.
 *
 *   seller = the Helpr, buyer = the poster (the same addresses, so the seat
 *   checks' proofRunInFlight exempts this run's Helpr while it can be running).
 *
 * THE PAYOUT DOOR IS release-payout { job_id }, NOT
 * process-scheduled-payouts?include_seed=1. That sweep takes every due seed job
 * (45 measured 2026-10-30) and is not scoped to a job. So the fee and debt
 * lines in process-scheduled-payouts are NOT exercised here; release-payout
 * takes the same one-time setup fee and Helpr-fault debt on its own lines.
 *
 * Fail-closed before the first write: the key is sk_test_/rk_test_, Stripe says
 * livemode=false. A checkout that is not cs_test_ is never opened. The job is
 * re-read is_seed, parish null, before paying. The account is re-read at Stripe
 * before release, and release is refused unless it is ready, so release-payout's
 * failure branches (most of its Slack alerts do not route seed) are not reached
 * by a run that already knows it cannot pay.
 *
 *   node scripts/e2e/jobPayoutProof.mjs run    --state <file> [--budget 100]
 *   node scripts/e2e/jobPayoutProof.mjs unlink --state <file>
 */
import { appendFileSync, writeFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { assertFreshCheckout } from "../lib/freshCheckout.mjs";
import { mintAdminSession, PUBLIC_ANON_KEY } from "../lib/adminSession.mjs";
import { acceptCurrentTerms } from "../lib/acceptCurrentTerms.mjs";
import { ensureTestAccountsEnrolled } from "../lib/testAccountEnrolment.mjs";
import { settleJobForward } from "./settleForward.mjs";
import {
  PROOF_TAG, TEST_BANK, accountRefusal, clients, env, isCustomAccountsDisabled, log, newRunId, payCheckout, poll, profileRefusal, proofEmail, testKeyRefusal, unlinkRun,
} from "./declutterPayoutProof.mjs";

assertFreshCheckout(import.meta.url);

const MARKER = "[E2E DO NOT ACCEPT]";
const save = (file, s) => writeFileSync(file, `${JSON.stringify(s, null, 2)}\n`);

/** A start 3 h out, Louisiana time (over refuse_short_notice_job's 2 h, inside the day-of doors' reach once hired). */
export function startSlot(now = new Date()) {
  const t = new Date(now.getTime() + 180 * 60_000);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(t).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:00` };
}

/** Every way a transfer differs from what the job's ledger row says (empty = exact). */
export function jobTransferProblems(transfer, { accountId, ledgerCents, jobId }) {
  const out = [];
  if (!transfer) return ["no transfer"];
  if (transfer.livemode !== false) out.push("transfer is not test mode");
  const dest = typeof transfer.destination === "string" ? transfer.destination : transfer.destination?.id;
  if (dest !== accountId) out.push(`destination ${dest} is not ${accountId}`);
  if (transfer.amount !== ledgerCents) out.push(`amount ${transfer.amount} is not the ledger's ${ledgerCents}`);
  if (transfer.reversed || transfer.amount_reversed !== 0) out.push("transfer is reversed");
  if (transfer.currency !== "usd") out.push(`currency ${transfer.currency}`);
  if ((transfer.metadata ?? {}).job_id && transfer.metadata.job_id !== jobId) out.push(`metadata job_id ${transfer.metadata.job_id}`);
  return out;
}

async function makeUser(c, e, state, role, file) {
  const email = proofEmail(state.runId, role);
  const name = `Payout Proof ${role === "seller" ? "Helpr" : "Poster"}`;
  // seed-policy: patched — the profile below is written is_seed: true.
  const user = await c.authAdmin("POST", "users", { email, email_confirm: true, user_metadata: { full_name: name } });
  if (!user?.id || String(user.email).toLowerCase() !== email) throw new Error(`auth admin create for ${role} returned no matching user`);
  state.users[role] = user.id;
  save(file, state);
  const profile = {
    user_id: user.id, email, full_name: name, date_of_birth: "1990-01-01", location: "Baton Rouge, LA", zip_code: "70801", ban_status: "active",
    is_seed: true, email_verified: true, idv_status: "verified", phone: `504555${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}`,
    avatar_url: `${e.base}/storage/v1/object/public/avatars/none.png`,
  };
  const existing = await c.rest("GET", `profiles?user_id=eq.${user.id}&select=user_id`);
  if (existing.length) await c.rest("PATCH", `profiles?user_id=eq.${user.id}`, profile);
  else await c.rest("POST", "profiles", profile);
}

async function readRow(c, id) {
  const [j] = await c.rest("GET", `jobs?id=eq.${id}&select=*`);
  return j;
}

async function run(file, budget) {
  const e = env();
  const refused = testKeyRefusal(e.key);
  if (refused) throw new Error(refused);
  if (!e.service) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  if (!file) throw new Error("--state <file> is required");
  if (!Number.isInteger(budget) || budget < 15 || budget > 500) throw new Error(`--budget ${budget} is not 15..500`);
  const c = clients(e);
  const bal = await c.stripe("GET", "/v1/balance");
  if (bal.livemode !== false) throw new Error("Stripe answered livemode=true; refusing");

  const state = { runId: newRunId(), startedAt: new Date().toISOString(), budget, users: {}, accountId: null, steps: [] };
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, { flag: "wx" });
  const step = (name, detail = {}) => {
    state.steps.push({ at: new Date().toISOString(), name, ...detail });
    save(file, state);
    log(`${name} ${Object.keys(detail).length ? JSON.stringify(detail) : ""}`);
  };
  let browser;
  try {
    // 1. Two throwaways.
    await makeUser(c, e, state, "seller", file);
    await makeUser(c, e, state, "buyer", file);
    const ids = [state.users.seller, state.users.buyer];
    await ensureTestAccountsEnrolled({ supabaseUrl: e.base, serviceKey: e.service, userIds: ids, note: `job-payout-proof ${state.runId}` }); // TEST-ACCOUNT-ENROLMENT
    const enrolledRows = await c.rest("GET", `test_accounts?select=user_id&user_id=in.(${ids.join(",")})`);
    const enrolled = new Set(enrolledRows.map((r) => r.user_id));
    const sess = {};
    for (const role of ["seller", "buyer"]) {
      const [row] = await c.rest("GET", `profiles?user_id=eq.${state.users[role]}&select=user_id,email,is_seed`);
      const why = profileRefusal(row, state, role, { enrolledIds: enrolled });
      if (why) throw new Error(`${role} is not a test account: ${why}`);
      sess[role] = await mintAdminSession({ email: proofEmail(state.runId, role), serviceKey: e.service, supabaseUrl: e.base, anonKey: PUBLIC_ANON_KEY });
      await acceptCurrentTerms(e.base, PUBLIC_ANON_KEY, sess[role].access_token, state.users[role]);
    }
    const helpr = c.as(sess.seller);
    const poster = c.as(sess.buyer);
    step("1 accounts", state.users);

    // 2. A Custom TEST-mode connected account.
    let acct;
    try {
      acct = await c.stripe("POST", "/v1/accounts", {
        type: "custom", country: "US", email: proofEmail(state.runId, "seller"), business_type: "individual",
        capabilities: { transfers: { requested: true }, card_payments: { requested: true } },
        business_profile: { mcc: "7349", product_description: "Local help jobs on Louisiana Helpr (test)" },
        individual: {
          first_name: "Payout", last_name: "Proof", email: proofEmail(state.runId, "seller"), phone: "0000000000",
          dob: { day: 1, month: 1, year: 1901 }, ssn_last_4: "0000", id_number: "000000000",
          address: { line1: "address_full_match", city: "Baton Rouge", state: "LA", postal_code: "70801", country: "US" },
        },
        external_account: { object: "bank_account", country: "US", currency: "usd", ...TEST_BANK },
        tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: "127.0.0.1" },
        metadata: { lh_proof: PROOF_TAG, lh_proof_run: state.runId, seller_user_id: state.users.seller, lh_proof_kind: "job" },
      }, { idem: `lh-job-${PROOF_TAG}-${state.runId}` });
    } catch (err) {
      if (isCustomAccountsDisabled(err)) {
        step("2 CUSTOM_ACCOUNTS_NOT_ENABLED", { stripe: err.stripeMessage });
        process.exitCode = 3;
        return;
      }
      throw err;
    }
    state.accountId = acct.id;
    save(file, state);
    if (accountRefusal(acct, state)) throw new Error(`created account: ${accountRefusal(acct, state)}`);
    acct = await poll("the test account's transfers capability", async () => {
      const a = await c.stripe("GET", `/v1/accounts/${state.accountId}`);
      return a.capabilities?.transfers === "active" && a.payouts_enabled === true ? a : null;
    }, { every: 5000, timeoutMs: 180_000 });
    step("2 account ready", { account: acct.id, transfers: acct.capabilities.transfers, payouts_enabled: acct.payouts_enabled });

    // A retained ban on Stripe's shared test bank would auto-ban the throwaway on link.
    const bankFp = acct.external_accounts?.data?.[0]?.fingerprint
      ?? (await c.stripe("GET", `/v1/accounts/${state.accountId}/external_accounts`, { object: "bank_account", limit: 1 })).data?.[0]?.fingerprint;
    if (!bankFp) throw new Error("no bank fingerprint to check against retained bans");
    const bankHash = await c.rest("POST", "rpc/ban_fingerprint", { p_domain: "bank", p_value: bankFp });
    const bans = await c.rest("GET", `retained_bans?select=id&bank_sha256=cs.${encodeURIComponent(`{${bankHash}}`)}`);
    if (bans.length) throw new Error(`the shared Stripe test bank is on ${bans.length} retained ban(s); not linking`);

    // 3. Link to the run's Helpr, sync the gate the real way.
    const linked = await c.rest("PATCH", `profiles?user_id=eq.${state.users.seller}&stripe_account_id=is.null&is_seed=is.true&select=user_id,stripe_account_id`, { stripe_account_id: state.accountId }, "return=representation");
    if (linked.length !== 1) throw new Error(`link matched ${linked.length} rows`);
    state.linkedAt = new Date().toISOString();
    save(file, state);
    const status = await helpr.fn("stripe-connect", { action: "status" });
    if (status?.account_id !== state.accountId || status?.payouts_enabled !== true || status?.transfers_status !== "active") throw new Error(`stripe-connect status: ${JSON.stringify(status)}`);
    step("3 linked + synced", { payouts_enabled: status.payouts_enabled });

    // 4. Post (as the poster's token), parish null, is_seed, the marker title.
    const slot = startSlot();
    const title = `${MARKER} py ${state.runId.slice(-6)}`;
    const posted = await fetch(`${e.base}/rest/v1/jobs?select=id,parish,is_seed`, {
      method: "POST",
      headers: { apikey: PUBLIC_ANON_KEY, Authorization: `Bearer ${sess.buyer.access_token}`, "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ customer_id: state.users.buyer, is_seed: true, title, description: "Automated payout proof. Not a real job; created by the test suite. Please ignore.", category: "cleaning", location: "4412 Highland Rd, Baton Rouge, LA 70808", parish: null, latitude: 30.4028, longitude: -91.1714, date_needed: slot.date, start_time: slot.time, budget, status: "open", payment_status: "unpaid", pricing_mode: "set_price" }),
    });
    const postedBody = await posted.text();
    if (!posted.ok) throw new Error(`post: HTTP ${posted.status} ${postedBody.slice(0, 300)}`);
    const [job] = JSON.parse(postedBody);
    if (job.is_seed !== true || job.parish !== null) throw new Error(`REFUSED: job ${job.id} is_seed=${job.is_seed} parish=${job.parish}`);
    state.jobId = job.id;
    step("4 posted", { job: job.id, budget });

    // 5. Pay: cs_test_ or it is never opened (payCheckout refuses anything else too).
    const esc = await poster.fn("create-payment", { action: "escrow", jobId: job.id });
    if (!/\/cs_test_[A-Za-z0-9]+/.test(String(esc?.url ?? ""))) throw new Error("REFUSED: create-payment did not mint a cs_test_ session; nothing was paid");
    const { chromium } = await import("@playwright/test");
    browser = await chromium.launch({ headless: true });
    await payCheckout(browser, esc.url, "the job");
    const funded = await poll("the webhook to fund the job", async () => {
      const j = await readRow(c, job.id);
      return ["escrow", "held"].includes(j.payment_status) ? j : null;
    }, { every: 3000, timeoutMs: 120_000 });
    step("5 funded", { payment_status: funded.payment_status, session: String(funded.stripe_session_id).slice(0, 8) });

    // 6. Hire through the product's doors. created_at aged the way ageJobPastEarlyAccess does.
    await c.rest("PATCH", `jobs?id=eq.${job.id}&is_seed=is.true&select=id`, { created_at: new Date(Date.now() - 30 * 60_000).toISOString() }, "return=representation");
    await helpr.rpc("apply_to_job", { p_job_id: job.id, p_message: `Payout proof ${state.runId}` });
    const [app] = await c.rest("GET", `applications?job_id=eq.${job.id}&helper_id=eq.${state.users.seller}&select=id`);
    await poster.rpc("accept_application", { p_application_id: app.id, p_deadline: new Date(Date.now() + 3_600_000).toISOString(), p_offer_message: null });
    const cap = await helpr.fn("create-payment", { action: "capture_hold", jobId: job.id });
    if (cap?.state !== "accepted") {
      const a = await helpr.rpc("accept_job_offer", { p_job_id: job.id });
      if (a?.state !== "accepted") throw new Error(`accept_job_offer: ${JSON.stringify(a)}`);
    }
    step("6 hired", { capture: cap?.state });

    // 7. Done and approved, the product's own path. Lands payout_pending.
    const settled = await settleJobForward({ base: e.base, anon: PUBLIC_ANON_KEY, posterToken: sess.buyer.access_token, helperToken: sess.seller.access_token, posterId: state.users.buyer, helperId: state.users.seller, jobId: job.id, log });
    if (!settled.settled) throw new Error(`settle forward: ${settled.reason} (${settled.status}/${settled.paymentStatus})`);
    const released = await readRow(c, job.id);
    const notices = await c.rest("GET", `notifications?job_id=eq.${job.id}&select=user_id,title,message,type&order=created_at.asc`);
    step("7 approved", { status: released.status, payment_status: released.payment_status, payout_scheduled_at: released.payout_scheduled_at, notices });

    // 8. The payout, for THIS job only.
    const live = await c.stripe("GET", `/v1/accounts/${state.accountId}`);
    if (accountRefusal(live, state) || !live.payouts_enabled || live.capabilities?.transfers !== "active") throw new Error("the account is not payable; release not called");
    // An empty test balance fails the transfer, and that branch can post to #ops-alerts: stop first.
    const balNow = await c.stripe("GET", "/v1/balance");
    if (balNow.livemode !== false) throw new Error("Stripe answered livemode=true; refusing");
    const availableUsd = (balNow.available ?? []).filter((b) => b.currency === "usd").reduce((n, b) => n + b.amount, 0);
    step("8 test balance", { available_usd_cents: availableUsd, needs_at_most_cents: budget * 100 });
    if (availableUsd < budget * 100) throw new Error(`Stripe TEST available balance ${availableUsd}c does not cover ${budget * 100}c; release not called, job ${job.id} stays payout_pending`);
    // release-payout takes CRON_SECRET or an admin (run 41138685238: the repo's service key is a 401).
    const cronSecret = process.env.CRON_SECRET ?? "";
    if (!cronSecret) throw new Error("CRON_SECRET is empty; release not called");
    const pay = await fetch(`${e.base}/functions/v1/release-payout`, {
      method: "POST", headers: { Authorization: `Bearer ${cronSecret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: job.id, initiated_by: "system" }), signal: AbortSignal.timeout(90_000),
    });
    const payBody = await pay.text();
    step("8 release-payout", { http: pay.status, body: payBody.slice(0, 500) });
    if (!pay.ok) throw new Error(`release-payout: HTTP ${pay.status} ${payBody.slice(0, 300)}`);
    const ledger = await poll("the payout_transfers row", async () => {
      const rows = await c.rest("GET", `payout_transfers?job_id=eq.${job.id}&select=*`);
      return rows.find((r) => r.stripe_transfer_id) ?? null;
    }, { every: 3000, timeoutMs: 120_000 });
    const transfer = await c.stripe("GET", `/v1/transfers/${ledger.stripe_transfer_id}`);
    const ledgerCents = ledger.amount_cents;
    const problems = jobTransferProblems(transfer, { accountId: state.accountId, ledgerCents, jobId: job.id });
    if (problems.length) throw new Error(`transfer does not match: ${problems.join("; ")}`);
    const pi = released.stripe_payment_intent_id ? await c.stripe("GET", `/v1/payment_intents/${released.stripe_payment_intent_id}`) : null;
    if (pi && pi.livemode !== false) throw new Error("the PaymentIntent is not test mode");
    state.result = { job: job.id, payment_intent: pi?.id, charged_cents: pi?.amount_received, transfer: transfer.id, transfer_cents: transfer.amount, ledger_cents: ledgerCents, account: state.accountId, budget_cents: budget * 100 };
    step("8 PAYOUT LANDED", state.result);

    // 9. A $3 tip, on Stripe's hosted page.
    const tip = await poster.fn("create-payment", { action: "tip", jobId: job.id, amount: 3, tipAttemptId: randomUUID(), native: false });
    if (!/\/cs_test_[A-Za-z0-9]+/.test(String(tip?.url ?? ""))) throw new Error("REFUSED: the tip is not a cs_test_ session");
    await payCheckout(browser, tip.url, "the tip");
    const tipRow = await poll("the tip row to be paid", async () => {
      const rows = await c.rest("GET", `tips?job_id=eq.${job.id}&select=*`);
      return rows.find((r) => r.payment_status === "paid" || r.payment_status === "succeeded") ?? null;
    }, { every: 3000, timeoutMs: 180_000 });
    const after = await c.rest("GET", `notifications?job_id=eq.${job.id}&select=user_id,title,message,type&order=created_at.asc`);
    state.tip = { status: tipRow.payment_status, amount: tipRow.amount, payment_intent: tipRow.stripe_payment_intent_id ?? null };
    step("9 tip paid", { tip: state.tip, notices: after });
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Job payout proof ${state.runId}\n\n\`\`\`json\n${JSON.stringify({ result: state.result, tip: state.tip }, null, 2)}\n\`\`\`\n`);
  } catch (err) {
    state.failure = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    if (browser) await browser.close().catch(() => {});
    try {
      await unlinkRun(c, state);
    } catch (err) {
      console.log(`::error title=Unlink failed::${err.message}`);
      process.exitCode = 1;
    }
    save(file, state);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf(`--${n}`); return i < 0 ? undefined : args[i + 1]; };
  const file = opt("state");
  if (args[0] === "run") return run(file, Number(opt("budget") || 100));
  if (args[0] === "unlink") {
    const e = env();
    const refused = testKeyRefusal(e.key);
    if (refused) throw new Error(refused);
    let state;
    try { state = JSON.parse(readFileSync(file, "utf8")); } catch { return log(`no state file ${file}; nothing was created`); }
    await unlinkRun(clients(e), state);
    return save(file, state);
  }
  throw new Error("usage: jobPayoutProof.mjs run|unlink --state <file> [--budget 100]");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.log(`::error title=Job payout proof failed::${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
